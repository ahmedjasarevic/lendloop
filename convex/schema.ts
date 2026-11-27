import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const toolCategoryValidator = v.union(
  v.literal("power-tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("hand-tools"),
  v.literal("other"),
);

export const toolConditionValidator = v.union(
  v.literal("like-new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled"),
);

export const automationStatusValidator = v.union(
  v.literal("queued"),
  v.literal("delivered"),
  v.literal("failed"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    name: v.string(),
    email: v.string(),
    imageUrl: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
    isTrustedLender: v.boolean(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    description: v.string(),
    // Soft delete: loans keep referencing the tool, so moderation never breaks history.
    status: v.union(v.literal("active"), v.literal("removed")),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"]),

  loans: defineTable({
    toolId: v.id("tools"),
    // Denormalized at request time so a listing edit/removal cannot re-target a loan.
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    // Inclusive calendar range, `YYYY-MM-DD`, timezone-free by design.
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
    status: loanStatusValidator,
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_endDate", ["status", "endDate"]),

  /**
   * Delivery log for every automation hop. `eventId` is the idempotency key:
   * Convex and n8n both derive it deterministically, so retries collapse into
   * one row instead of duplicating notifications.
   */
  automationEvents: defineTable({
    eventId: v.string(),
    loanId: v.optional(v.id("loans")),
    direction: v.union(v.literal("outbound"), v.literal("inbound")),
    type: v.string(),
    status: automationStatusValidator,
    detail: v.optional(v.string()),
    attempt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_loan", ["loanId"]),
});
