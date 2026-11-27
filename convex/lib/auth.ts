import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Viewer = Doc<"users">;

export function unauthenticated(): never {
  throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
}

export function forbidden(message = "You are not allowed to do that."): never {
  throw new ConvexError({ code: "FORBIDDEN", message });
}

export function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID_INPUT", message });
}

export function notFound(message = "Not found."): never {
  throw new ConvexError({ code: "NOT_FOUND", message });
}

/**
 * Comma-separated list of emails that are promoted to the admin role the first
 * time they sign in. Kept in a deployment env var so no admin emails are ever
 * committed to the repository.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

/** Shape exposed to other users: no email addresses, no Clerk identifiers. */
export function publicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    name: user.name,
    isTrustedLender: user.isTrustedLender,
    imageUrl: user.imageUrl ?? null,
    role: user.role,
  };
}

/**
 * Read-only viewer lookup. Queries cannot provision users, so they tolerate a
 * missing row (happens for a few hundred ms after the first sign-in).
 */
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/**
 * Mutations provision the user row on demand. This avoids a Clerk webhook
 * dependency (no public endpoint, no signature secret to manage) and means the
 * very first write after sign-up still works.
 */
export async function requireViewer(ctx: MutationCtx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) unauthenticated();

  const email = (identity.email ?? "").toLowerCase();
  const name = identity.name ?? identity.email?.split("@")[0] ?? "Neighbor";

  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();

  if (existing) {
    // Clerk remains the source of truth for profile fields. Admin promotion is
    // re-evaluated on every write, so setting ADMIN_EMAILS after sign-up still
    // works without touching the database by hand (demotion stays manual).
    const shouldBeAdmin = isAdminEmail(email);
    const nextRole = existing.role === "admin" || shouldBeAdmin ? "admin" : existing.role;

    if (existing.name !== name || existing.email !== email || existing.role !== nextRole) {
      await ctx.db.patch(existing._id, { name, email, role: nextRole });
      return { ...existing, name, email, role: nextRole };
    }
    return existing;
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    clerkUserId: identity.subject ?? "",
    name,
    email,
    imageUrl: identity.pictureUrl ?? undefined,
    role: isAdminEmail(email) ? "admin" : "user",
    isTrustedLender: false,
  });

  const created = await ctx.db.get(userId);
  if (!created) notFound("User could not be created.");
  return created;
}

export async function requireAdmin(ctx: MutationCtx): Promise<Viewer> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") forbidden("Admin access required.");
  return viewer;
}

/**
 * Query-side viewer lookup: requires a valid Clerk identity, but tolerates a
 * missing user row. Queries cannot provision, and on the very first dashboard
 * render `users.ensure` may still be in flight — that window must not throw.
 */
export async function getViewerForQuery(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) unauthenticated();
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewerForQuery(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await getViewerForQuery(ctx);
  if (!viewer) unauthenticated();
  return viewer;
}

export async function requireAdminForQuery(ctx: QueryCtx): Promise<Viewer> {
  const viewer = await requireViewerForQuery(ctx);
  if (viewer.role !== "admin") forbidden("Admin access required.");
  return viewer;
}

/** Strict ownership: admins may moderate content, but may not edit it. */
export function assertOwner(viewer: Viewer, ownerId: Id<"users">, message?: string): void {
  if (viewer._id !== ownerId) forbidden(message);
}

/** Ownership with an admin override, used for moderation (remove listing). */
export function assertOwnerOrAdmin(viewer: Viewer, ownerId: Id<"users">, message?: string): void {
  if (viewer._id !== ownerId && viewer.role !== "admin") forbidden(message);
}
