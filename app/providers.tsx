"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useMemo } from "react";

function MissingConfig({ items }: { items: string[] }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-semibold text-amber-900">Configuration required</h1>
        <p className="mt-2 text-sm text-amber-800">
          LendLoop needs Clerk and Convex keys before it can render. Copy <code>.env.example</code>{" "}
          to <code>.env.local</code> and fill in:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-amber-900">
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-amber-700">
          See the README&apos;s &quot;Local setup&quot; section for the full walkthrough.
        </p>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const convex = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    [convexUrl],
  );

  if (!convexUrl || !clerkKey || !convex) {
    return (
      <MissingConfig
        items={["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]}
      />
    );
  }

  return (
    <ClerkProvider publishableKey={clerkKey}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
