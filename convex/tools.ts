import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  assertOwner,
  assertOwnerOrAdmin,
  getViewerForQuery,
  invalid,
  notFound,
  publicUser,
  requireAdminForQuery,
  requireViewer,
} from "./lib/auth";
import { isToolCategory, isToolCondition } from "./lib/categories";
import { rangesOverlap, todayISO } from "./lib/dates";
import { toolCategoryValidator, toolConditionValidator } from "./schema";

const MAX_ACTIVE_LISTINGS = 25;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function cleanText(value: string, field: string, min: number, max: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.length < min) invalid(`${field} must be at least ${min} characters.`);
  if (cleaned.length > max) invalid(`${field} must be at most ${max} characters.`);
  return cleaned;
}

/**
 * Public projection: a stranger sees what is on the board, never who owns it.
 * This is the only tool query reachable without a Clerk session.
 *
 * "Available" is evaluated here too: a tool that is currently lent out drops off
 * the public list, even though the public payload still carries no dates.
 */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const today = todayISO();
    const [tools, approvedLoans] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .order("desc")
        .take(100),
      ctx.db
        .query("loans")
        .withIndex("by_status_endDate", (q) => q.eq("status", "approved"))
        .take(500),
    ]);

    const onLoan = new Set(
      approvedLoans.filter((loan) => loan.startDate <= today).map((loan) => loan.toolId),
    );

    return tools
      .filter((tool) => !onLoan.has(tool._id))
      .map((tool) => ({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
      }));
  },
});

/**
 * Signed-in board: adds condition, description, owner display name and live
 * availability. Availability is derived from approved loans, never stored, so it
 * cannot drift out of sync.
 */
export const listAvailable = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerForQuery(ctx);
    const [tools, approvedLoans] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .order("desc")
        .take(200),
      ctx.db
        .query("loans")
        .withIndex("by_status_endDate", (q) => q.eq("status", "approved"))
        .take(500),
    ]);

    const today = todayISO();
    const loansByTool = new Map<Id<"tools">, Doc<"loans">[]>();
    for (const loan of approvedLoans) {
      const list = loansByTool.get(loan.toolId) ?? [];
      list.push(loan);
      loansByTool.set(loan.toolId, list);
    }

    const ownerIds = Array.from(new Set(tools.map((tool) => tool.ownerId)));
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const ownersById = new Map(owners.filter(Boolean).map((owner) => [owner!._id, owner!]));

    return tools.map((tool) => {
      const loans = loansByTool.get(tool._id) ?? [];
      // An approved loan is out until it is marked returned, even if its end
      // date has already passed (overdue). Only future bookings are "upcoming".
      const current = loans.find((loan) => loan.startDate <= today);
      const upcoming = loans
        .filter((loan) => loan.startDate > today)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      const owner = ownersById.get(tool.ownerId);

      return {
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        owner: owner ? publicUser(owner) : null,
        isMine: viewer?._id === tool.ownerId,
        onLoanUntil: current?.endDate ?? null,
        isOverdue: current ? current.endDate < today : false,
        nextBookingStart: upcoming?.startDate ?? null,
      };
    });
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerForQuery(ctx);
    if (!viewer) return [];
    const [tools, loans] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
        .order("desc")
        .collect(),
      ctx.db
        .query("loans")
        .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
        .collect(),
    ]);

    return tools.map((tool) => ({
      _id: tool._id,
      name: tool.name,
      category: tool.category,
      condition: tool.condition,
      description: tool.description,
      status: tool.status,
      pendingRequests: loans.filter((loan) => loan.toolId === tool._id && loan.status === "pending")
        .length,
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    if (!isToolCategory(args.category) || !isToolCondition(args.condition)) {
      invalid("Unknown category or condition.");
    }

    const existing = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .collect();
    const active = existing.filter((tool) => tool.status === "active");
    if (active.length >= MAX_ACTIVE_LISTINGS) {
      invalid(`You can list at most ${MAX_ACTIVE_LISTINGS} tools.`);
    }

    const now = Date.now();
    return await ctx.db.insert("tools", {
      ownerId: viewer._id,
      name: cleanText(args.name, "Name", 2, MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 5, MAX_DESCRIPTION),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) notFound("Listing not found.");
    // Admins may moderate (remove) but must not rewrite someone else's content.
    assertOwner(viewer, tool.ownerId, "You can only edit your own listings.");
    if (tool.status !== "active") invalid("This listing was removed and can no longer be edited.");

    await ctx.db.patch(tool._id, {
      name: cleanText(args.name, "Name", 2, MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", 5, MAX_DESCRIPTION),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) notFound("Listing not found.");
    assertOwnerOrAdmin(viewer, tool.ownerId);
    if (tool.status === "removed") return;

    const now = Date.now();
    await ctx.db.patch(tool._id, {
      status: "removed",
      removedAt: now,
      removedBy: viewer._id,
      updatedAt: now,
    });

    // Pending requests must not dangle once the tool is gone. Declining them
    // here also emits the same notification path as a manual decline.
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .collect();

    for (const loan of loans) {
      if (loan.status !== "pending") continue;
      await ctx.db.patch(loan._id, { status: "declined", respondedAt: now });
      await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
        loanId: loan._id,
        eventType: "request_declined",
      });
    }
  },
});

/** Admin moderation view. Includes removed listings so actions are auditable. */
export const listAllForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminForQuery(ctx);
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const owners = await Promise.all(tools.map((tool) => ctx.db.get(tool.ownerId)));
    const ownersById = new Map(
      owners.filter(Boolean).map((owner) => [owner!._id, owner!]),
    );

    return tools.map((tool) => {
      const owner = ownersById.get(tool.ownerId);
      return {
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        status: tool.status,
        owner: owner ? publicUser(owner) : null,
        createdAt: tool.createdAt,
      };
    });
  },
});
