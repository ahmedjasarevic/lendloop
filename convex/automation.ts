import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { daysBetween, isISODate, todayISO } from "./lib/dates";
import { signRequest } from "./lib/hmac";

/**
 * Logical route id signed on the wire. It is deliberately not the real n8n URL
 * path, because self-hosted n8n uses `/webhook/...` while n8n Cloud may add its
 * own prefix. Both sides only have to agree on this constant.
 */
export const REQUEST_EVENT_PATH = "/lendloop/request-event";

const BACKOFF_MS = [30_000, 120_000, 600_000];
const MAX_DETAIL = 500;

const RECIPIENT_BY_EVENT: Record<string, "owner" | "borrower"> = {
  request_created: "owner",
  request_approved: "borrower",
  request_declined: "borrower",
  request_cancelled: "owner",
  loan_returned: "owner",
};

function truncate(value: string, max = MAX_DETAIL): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return truncate(error.message);
  return truncate(String(error));
}

/**
 * Minimal notification payload. Only the recipient's address leaves the
 * database, plus the fields the message body actually renders.
 */
export const buildRequestEvent = internalQuery({
  args: {
    loanId: v.id("loans"),
    eventType: v.string(),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return null;

    const [tool, owner, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.ownerId),
      ctx.db.get(loan.borrowerId),
    ]);
    if (!tool || !owner || !borrower) return null;

    const recipientRole = RECIPIENT_BY_EVENT[args.eventType] ?? "owner";
    const recipient = recipientRole === "owner" ? owner : borrower;
    const appUrl = (process.env.LENDLOOP_APP_URL ?? "").replace(/\/$/, "");

    return {
      eventId: `request:${loan._id}:${args.eventType}`,
      event: args.eventType,
      loanId: loan._id,
      toolName: tool.name,
      category: tool.category,
      startDate: loan.startDate,
      endDate: loan.endDate,
      status: loan.status,
      borrowerName: borrower.name,
      ownerName: owner.name,
      recipient: { name: recipient.name, email: recipient.email },
      link: `${appUrl}${recipientRole === "owner" ? "/incoming" : "/requests"}`,
      occurredAt: new Date().toISOString(),
    };
  },
});

export const recordOutbound = internalMutation({
  args: {
    eventId: v.string(),
    loanId: v.id("loans"),
    type: v.string(),
    status: v.union(v.literal("queued"), v.literal("delivered"), v.literal("failed")),
    detail: v.optional(v.string()),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    const now = Date.now();

    if (existing) {
      // A retry updates the same row, so the activity feed never shows duplicates.
      await ctx.db.patch(existing._id, {
        status: args.status,
        detail: args.detail,
        attempt: args.attempt,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("automationEvents", {
      eventId: args.eventId,
      loanId: args.loanId,
      direction: "outbound",
      type: args.type,
      status: args.status,
      detail: args.detail,
      attempt: args.attempt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Signed POST into n8n. Runs as a scheduled action so a slow or broken
 * integration can never block or fail the user's mutation.
 */
export const dispatchRequestEvent = internalAction({
  args: {
    loanId: v.id("loans"),
    eventType: v.string(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 0;
    const eventId = `request:${args.loanId}:${args.eventType}`;

    const payload = await ctx.runQuery(internal.automation.buildRequestEvent, {
      loanId: args.loanId,
      eventType: args.eventType,
    });
    if (!payload) return;

    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    const url = process.env.N8N_REQUEST_WEBHOOK_URL;

    if (!secret || !url) {
      await ctx.runMutation(internal.automation.recordOutbound, {
        eventId,
        loanId: args.loanId,
        type: args.eventType,
        status: "failed",
        detail: "Automation is not configured (LENDLOOP_WEBHOOK_SECRET / N8N_REQUEST_WEBHOOK_URL).",
        attempt,
      });
      console.error("[automation] missing webhook configuration, check Convex env vars");
      return;
    }

    if (attempt === 0) {
      await ctx.runMutation(internal.automation.recordOutbound, {
        eventId,
        loanId: args.loanId,
        type: args.eventType,
        status: "queued",
        attempt,
      });
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = signRequest(secret, timestamp, "POST", REQUEST_EVENT_PATH, body);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lendloop-timestamp": timestamp,
          "x-lendloop-signature": signature,
          "x-lendloop-event-id": eventId,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`n8n webhook responded with ${response.status}`);
      }

      await ctx.runMutation(internal.automation.recordOutbound, {
        eventId,
        loanId: args.loanId,
        type: args.eventType,
        status: "delivered",
        attempt,
      });
    } catch (error) {
      const detail = describeError(error);
      await ctx.runMutation(internal.automation.recordOutbound, {
        eventId,
        loanId: args.loanId,
        type: args.eventType,
        status: "failed",
        detail,
        attempt,
      });

      if (attempt < BACKOFF_MS.length) {
        await ctx.scheduler.runAfter(BACKOFF_MS[attempt], internal.automation.dispatchRequestEvent, {
          loanId: args.loanId,
          eventType: args.eventType,
          attempt: attempt + 1,
        });
      } else {
        console.error(`[automation] giving up on ${eventId}: ${detail}`);
      }
    }
  },
});

/**
 * Read model for the scheduled n8n workflow. `date` is supplied by the caller
 * and used in the idempotency key, so a re-run on the same day is a no-op.
 */
export const listOverdue = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    const today = isISODate(args.date) ? args.date : todayISO();

    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status_endDate", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(200);

    const rows = await Promise.all(
      overdue.map(async (loan) => {
        const [tool, owner, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
        ]);
        if (!tool || !owner || !borrower) return null;

        return {
          eventId: `overdue:${loan._id}:${today}`,
          loanId: loan._id,
          toolName: tool.name,
          startDate: loan.startDate,
          endDate: loan.endDate,
          daysOverdue: daysBetween(loan.endDate, today),
          borrower: { name: borrower.name, email: borrower.email },
          ownerName: owner.name,
          remindersSent: loan.reminderCount,
          lastReminderAt: loan.lastReminderAt ?? null,
        };
      }),
    );

    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

/**
 * Idempotent write-back from n8n. The dedupe lookup and the insert are one
 * serializable Convex mutation, so two concurrent retries cannot both insert.
 */
export const recordInboundEvent = internalMutation({
  args: {
    eventId: v.string(),
    loanId: v.optional(v.id("loans")),
    type: v.string(),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    detail: v.optional(v.string()),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();

    if (existing) return { duplicate: true };

    if (args.loanId) {
      const loan = await ctx.db.get(args.loanId);
      if (!loan) return { duplicate: false, ignored: true };

      if (args.type === "overdue_reminder_delivered" && args.status === "delivered") {
        await ctx.db.patch(loan._id, {
          lastReminderAt: args.occurredAt,
          reminderCount: loan.reminderCount + 1,
        });
      }
    }

    const now = Date.now();
    await ctx.db.insert("automationEvents", {
      eventId: args.eventId,
      loanId: args.loanId,
      direction: "inbound",
      type: args.type,
      status: args.status,
      detail: args.detail ? truncate(args.detail) : undefined,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { duplicate: false };
  },
});
