import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  forbidden,
  getViewer,
  publicUser,
  requireAdmin,
  requireAdminForQuery,
  requireViewer,
} from "./lib/auth";

/** Current viewer, including fields only the viewer is allowed to see (email). */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getViewer(ctx);
    if (!user) return null;
    return {
      ...publicUser(user),
      email: user.email,
      isAdmin: user.role === "admin",
    };
  },
});

/**
 * Idempotent provisioning call made by the client right after sign-in, so the
 * role badge and admin nav render before the first mutation happens.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireViewer(ctx);
    return { _id: user._id, role: user.role };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminForQuery(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    return users.map((user) => ({
      ...publicUser(user),
      email: user.email,
      createdAt: user._creationTime,
    }));
  },
});

export const setTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    trusted: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user) forbidden("User not found.");
    await ctx.db.patch(args.userId, { isTrustedLender: args.trusted });
  },
});
