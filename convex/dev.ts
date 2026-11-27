import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { isoDayOffset, todayISO } from "./lib/dates";

/**
 * Test/runbook helper, internal only (not callable from the browser):
 *
 *   npx convex run dev:backdateLoan '{"loanId":"<id>"}'
 *
 * Marks a loan as approved with an end date in the past so the scheduled
 * overdue workflow can be exercised without waiting for real time to pass.
 */
export const backdateLoan = internalMutation({
  args: {
    loanId: v.optional(v.id("loans")),
    daysAgo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const loan = args.loanId
      ? await ctx.db.get(args.loanId)
      : await ctx.db.query("loans").order("desc").first();
    if (!loan) throw new Error("Loan not found");

    const days = args.daysAgo ?? 2;
    const endDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - (days + 3) * 86_400_000).toISOString().slice(0, 10);

    await ctx.db.patch(loan._id, {
      status: "approved",
      startDate,
      endDate,
      respondedAt: Date.now(),
      returnedAt: undefined,
    });

    return { loanId: loan._id, startDate, endDate };
  },
});

/**
 * Creates a pending borrow request for an existing user and fires the same
 * scheduled notification path the UI uses:
 *
 *   npx convex run dev:simulateRequest '{"borrowerEmail":"you@example.com","toolName":"Cordless drill"}'
 *
 * Internal only. It skips the overlap/duplicate validation on purpose, because
 * its job is to trigger automation, not to model the business rules (those are
 * covered by `loans.request`).
 */
export const simulateRequest = internalMutation({
  args: {
    borrowerEmail: v.optional(v.string()),
    toolName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fallbackEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim();
    const email = (args.borrowerEmail ?? fallbackEmail ?? "").trim().toLowerCase();
    if (!email) throw new Error("Pass borrowerEmail or set ADMIN_EMAILS");
    const users = await ctx.db.query("users").take(200);
    const borrower = users.find((user) => user.email.toLowerCase() === email);
    if (!borrower) throw new Error(`No user with email ${args.borrowerEmail}`);

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const approved = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved"))
      .collect();
    const busy = new Set(approved.map((loan) => loan.toolId));

    const tool = args.toolName
      ? tools.find((candidate) => candidate.name === args.toolName)
      : tools.find((candidate) => candidate.ownerId !== borrower._id && !busy.has(candidate._id));

    if (!tool) throw new Error("No matching active tool");
    if (tool.ownerId === borrower._id) throw new Error("Borrower owns that tool");

    const startDate = todayISO();
    const endDate = isoDayOffset(startDate, 2);

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate,
      endDate,
      note: "Simulated request for the automation test.",
      status: "pending",
      createdAt: Date.now(),
      reminderCount: 0,
    });

    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId,
      eventType: "request_created",
    });

    return { loanId, toolName: tool.name, startDate, endDate };
  },
});

/**
 * Creates a pending request FROM a seeded neighbor ONTO one of the admin's own
 * tools, so the lender flow (approve / decline / mark returned) can be exercised
 * without a second Clerk account:
 *
 *   npx convex run dev:simulateIncoming
 *
 * Internal only.
 */
export const simulateIncoming = internalMutation({
  args: {},
  handler: async (ctx) => {
    const adminEmail = (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim().toLowerCase();
    if (!adminEmail) throw new Error("ADMIN_EMAILS is not set");

    const users = await ctx.db.query("users").take(200);
    const owner = users.find((user) => user.email.toLowerCase() === adminEmail);
    if (!owner) throw new Error("Admin user not found — sign in once first");

    const borrower = users.find((user) => user.clerkUserId.startsWith("seed_"));
    if (!borrower) throw new Error("Run `npx convex run seed:demo` first");

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const active = tools.filter((tool) => tool.status === "active");
    if (active.length === 0) throw new Error("List a tool first (My listings → List a tool)");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id))
      .collect();
    const busy = new Set(loans.filter((loan) => loan.status === "approved").map((loan) => loan.toolId));
    const tool = active.find((candidate) => !busy.has(candidate._id)) ?? active[0];

    const startDate = todayISO();
    const endDate = isoDayOffset(startDate, 3);

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: owner._id,
      borrowerId: borrower._id,
      startDate,
      endDate,
      note: `Hi! Can I borrow the ${tool.name.toLowerCase()} this week?`,
      status: "pending",
      createdAt: Date.now(),
      reminderCount: 0,
    });

    await ctx.scheduler.runAfter(0, internal.automation.dispatchRequestEvent, {
      loanId,
      eventType: "request_created",
    });

    return { loanId, toolName: tool.name, borrower: borrower.email, startDate, endDate };
  },
});

/**
 * Prints the latest automation events straight from the database:
 *
 *   npx convex run dev:recentActivity
 *
 * Useful to confirm a notification without trusting the UI.
 */
export const recentActivity = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("automationEvents")
      .order("desc")
      .take(args.limit ?? 8);

    return events.map((event) => ({
      at: new Date(event.updatedAt).toISOString(),
      direction: event.direction,
      type: event.type,
      status: event.status,
      detail: event.detail ?? null,
      eventId: event.eventId,
    }));
  },
});

/**
 * Clears loans and automation events (keeps users and tools) so a demo or a
 * recording starts from a clean board:
 *
 *   npx convex run dev:resetDemo
 *
 * Internal only. Destructive on purpose.
 */
export const resetDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db.query("loans").collect();
    for (const loan of loans) await ctx.db.delete(loan._id);

    const events = await ctx.db.query("automationEvents").collect();
    for (const event of events) await ctx.db.delete(event._id);

    return { deletedLoans: loans.length, deletedEvents: events.length };
  },
});
