import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/**
 * Optional demo data so a fresh deployment has a board worth looking at.
 *
 *   npx convex run seed:demo
 *
 * Internal mutation: not reachable from the browser. Idempotent — it checks for
 * the seed marker before inserting anything. No loans or automation events are
 * fabricated, so the activity feed only ever shows real workflow runs.
 */

const NEIGHBORS = [
  { clerkUserId: "seed_amina", name: "Amina H.", email: "amina@example.com" },
  { clerkUserId: "seed_tarik", name: "Tarik B.", email: "tarik@example.com" },
  { clerkUserId: "seed_jelena", name: "Jelena P.", email: "jelena@example.com" },
];

const TOOLS: Array<{
  owner: number;
  name: string;
  category: "power-tools" | "garden" | "kitchen" | "camping" | "hand-tools" | "other";
  condition: "like-new" | "good" | "fair" | "worn";
  description: string;
}> = [
  {
    owner: 0,
    name: "Cordless drill",
    category: "power-tools",
    condition: "good",
    description: "18V drill with two batteries, charger and a bit set. Please return the bits in the case.",
  },
  {
    owner: 1,
    name: "3m extension ladder",
    category: "other",
    condition: "fair",
    description: "Aluminium, folds flat, fits in a hallway. Best picked up by car.",
  },
  {
    owner: 2,
    name: "Stand mixer",
    category: "kitchen",
    condition: "like-new",
    description: "5L bowl, whisk and dough hook. Great for a weekend of baking.",
  },
  {
    owner: 0,
    name: "4-person tent",
    category: "camping",
    condition: "good",
    description: "Two-season dome tent. Small repair on the stuff sack, the tent itself is dry.",
  },
  {
    owner: 1,
    name: "Hedge trimmer",
    category: "garden",
    condition: "fair",
    description: "Corded electric trimmer, 45cm blade. Works well on small hedges.",
  },
];

export const demo = internalMutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const marker = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", "seed_amina"))
      .unique();

    if (marker && !args.force) {
      return { seeded: false, reason: "demo data already present" };
    }

    const ownerIds: Array<Id<"users">> = [];
    for (const neighbor of NEIGHBORS) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", neighbor.clerkUserId))
        .unique();

      ownerIds.push(
        existing
          ? existing._id
          : await ctx.db.insert("users", {
              tokenIdentifier: `seed|${neighbor.clerkUserId}`,
              clerkUserId: neighbor.clerkUserId,
              name: neighbor.name,
              email: neighbor.email,
              role: "user",
              isTrustedLender: neighbor.clerkUserId === "seed_amina",
            }),
      );
    }

    const existingTools = await ctx.db.query("tools").collect();
    const alreadySeeded = new Set(existingTools.map((tool) => `${tool.ownerId}:${tool.name}`));
    const now = Date.now();
    let inserted = 0;

    for (const tool of TOOLS) {
      const ownerKey = ownerIds[tool.owner];
      if (!ownerKey) continue;
      const key = `${ownerKey}:${tool.name}`;
      if (alreadySeeded.has(key)) continue;

      await ctx.db.insert("tools", {
        ownerId: ownerKey,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    return { seeded: true, users: ownerIds.length, tools: inserted };
  },
});
