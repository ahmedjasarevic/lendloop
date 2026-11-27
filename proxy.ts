import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk v7 (Core 3) recommends resource-based auth checks instead of path
 * matching in middleware. The dashboard layout calls `auth()` and redirects, and
 * every Convex function re-checks the viewer, so this file only needs to make the
 * Clerk auth context available.
 */
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
