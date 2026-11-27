import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  assertOwner,
  forbidden,
  getViewerForQuery,
  invalid,
  notFound,
  publicUser,
  requireAdminForQuery,
  requireViewer,
} from "./lib/auth";
import { daysBetween, isISODate, rangesOverlap, todayISO } from "./lib/dates";

const MAX_LOAN_DAYS = 90;
const MAX_NOTE = 280;

/**
 * One read model for every list view. It answers "can the viewer act on this?"
 * in the client, while the mutations re-check the same rules server-side.
 */
async function enrichLoan(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, owner, borrower, events] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.ownerId),
    ctx.db.get(loan.borrowerId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(8),
  ]);

  const today = todayISO();
  const isOverdue = loan.status === "approved" && loan.endDate < today;

  // A delivered outbound event and its inbound receipt describe the same hop.
  // Keep the receipt (it is the stronger evidence) and drop the duplicate, while
  // still surfacing anything that failed or never got a receipt.
  const deliveredReceipts = new Set(
    events
      .filter((event) => event.direction === "inbound" && event.status === "delivered")
      .map((event) => event.eventId),
  );
  const activity = events.filter(
    (event) =>
      !(event.direction === "outbound" && deliveredReceipts.has(`delivery:${event.eventId}`)),
  );

  return {
    _id: loan._id,
    _creationTime: loan._creationTime,
    startDate: loan.startDate,
    endDate: loan.endDate,
    note: loan.note ?? null,
    status: loan.status,
    createdAt: loan.createdAt,
    respondedAt: loan.respondedAt ?? null,
    returnedAt: loan.returnedAt ?? null,
    lastReminderAt: loan.lastReminderAt ?? null,
    reminderCount: loan.reminderCount,
    isOverdue,
    daysOverdue: isOverdue ? daysBetween(loan.endDate, today) : 0,
    tool: tool
      ? { _id: tool._id, name: tool.name, category: tool.category, status: tool.status }
      : null,
    owner: owner ? publicUser(owner) : null,
    borrower: borrower ? publicUser(borrower) : null,
    recentActivity: activity.map((event) => ({
      _id: event._id,
      type: event.type,
      status: event.status,
      detail: event.detail ?? null,
      createdAt: event.createdAt,
    })),
  };
}

function validateRange(startDate: string, endDate: string): void {
  if (!isISODate(startDate) || !isISODate(endDate)) invalid("Pick a valid date range.");
  if (endDate < startDate) invalid("The return date must be on or after the pickup date.");
  if (startDate < todayISO()) invalid("The pickup date cannot be in the past.");
  if (daysBetween(startDate, endDate) > MAX_LOAN_DAYS) {
    invalid(`Loans are limited to ${MAX_LOAN_DAYS} days.`);
  }
}

export const request = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const borrower = await requireViewer(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.status !== "active") notFound("This tool is no longer available.");
    if (tool.ownerId === borrower._id) invalid("You cannot borrow your own tool.");

    validateRange(args.startDate, args.endDate);

    const note = (args.note ?? "").trim();
    if (note.length > MAX_NOTE) invalid(`Note must be at most ${MAX_NOTE} characters.`);

    const existing = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", tool._id))
      .collect();

    const duplicate = existing.find(
      (loan) =>
        loan.borrowerId === borrower._id &&
        loan.status === "pending" &&
        rangesOverlap(loan.startDate, loan.endDate, args.startDate, args.endDate),
    );
    if (duplicate) invalid("You already have a pending request covering those dates.");

    const booked = existing.find(
      (loan) =>
        loan.status === "approved" &&
        rangesOverlap(loan.startDate, loan.endDate, args.startDate, args.endDate),
    );
    if (booked) invalid("Those dates are already booked. Pick another range.");

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      note: note || undefined,
      status: "pending",
      createdAt: now,
      reminderCount: 0,
    });

    // Fire-and-forget: the mutation never waits on n8n, and the scheduled action
    // owns retries + delivery logging.
    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId,
      eventType: "request_created",
    });

    return loanId;
  },
});

export const decide = mutation({
  args: {
    loanId: v.id("loans"),
    decision: v.union(v.literal("approve"), v.literal("decline")),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) notFound("Request not found.");
    assertOwner(viewer, loan.ownerId, "Only the lender can respond to this request.");
    if (loan.status !== "pending") invalid("This request has already been handled.");

    const now = Date.now();

    if (args.decision === "decline") {
      await ctx.db.patch(loan._id, { status: "declined", respondedAt: now });
    } else {
      const tool = await ctx.db.get(loan.toolId);
      if (!tool || tool.status !== "active") invalid("This tool is no longer listed.");

      const siblings = await ctx.db
        .query("loans")
        .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
        .collect();
      const conflict = siblings.find(
        (other) =>
          other._id !== loan._id &&
          other.status === "approved" &&
          rangesOverlap(other.startDate, other.endDate, loan.startDate, loan.endDate),
      );
      if (conflict) invalid("Another approved loan already covers those dates.");

      await ctx.db.patch(loan._id, { status: "approved", respondedAt: now });
    }

    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId: loan._id,
      eventType: args.decision === "approve" ? "request_approved" : "request_declined",
    });
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) notFound("Request not found.");
    if (loan.borrowerId !== viewer._id) forbidden("You can only cancel your own requests.");
    if (loan.status !== "pending") invalid("Only pending requests can be cancelled.");

    await ctx.db.patch(loan._id, { status: "cancelled", respondedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId: loan._id,
      eventType: "request_cancelled",
    });
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) notFound("Loan not found.");

    const isLender = loan.ownerId === viewer._id;
    const isBorrower = loan.borrowerId === viewer._id;
    if (!isLender && !isBorrower) forbidden("Only the lender or the borrower can close this loan.");
    if (loan.status !== "approved") invalid("Only an approved loan can be marked as returned.");

    await ctx.db.patch(loan._id, { status: "returned", returnedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId: loan._id,
      eventType: "loan_returned",
    });
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerForQuery(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => enrichLoan(ctx, loan)));
  },
});

export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerForQuery(ctx);
    if (!viewer) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(100);
    return await Promise.all(loans.map((loan) => enrichLoan(ctx, loan)));
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminForQuery(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return await Promise.all(loans.map((loan) => enrichLoan(ctx, loan)));
  },
});
