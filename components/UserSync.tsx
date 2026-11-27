"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";

import { api } from "@/convex/_generated/api";

/**
 * Provisions the Convex `users` row right after sign-in so the nav can show the
 * viewer's role before they perform their first write. Mutations also upsert, so
 * a failure here is cosmetic, never blocking.
 */
export function UserSync() {
  const { isAuthenticated } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensure);

  useEffect(() => {
    if (!isAuthenticated) return;
    void ensureUser({}).catch(() => {
      // The next mutation retries provisioning; surfacing a toast here would be noise.
    });
  }, [isAuthenticated, ensureUser]);

  return null;
}
