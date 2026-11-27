import type { AuthConfig } from "convex/server";

/**
 * Clerk integration.
 *
 * The `domain` is your Clerk Frontend API / issuer domain and it has to match
 * the `iss` claim of the JWT template named "convex".
 * Set it with: npx convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
