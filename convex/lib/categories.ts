/**
 * Tool categories are shared by the Convex schema, the mutations and the React UI.
 * Keep `toolCategoryValidator` in sync: it is generated from this list on purpose,
 * so a forgotten category fails loudly in dev instead of silently accepting input.
 */
export const TOOL_CATEGORIES = [
  "power-tools",
  "garden",
  "kitchen",
  "camping",
  "hand-tools",
  "other",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  "power-tools": "Power tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  "hand-tools": "Hand tools",
  other: "Other",
};

export const CONDITIONS = ["like-new", "good", "fair", "worn"] as const;

export type ToolCondition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<ToolCondition, string> = {
  "like-new": "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as ToolCategory] ?? category;
}

export function conditionLabel(condition: string): string {
  return CONDITION_LABELS[condition as ToolCondition] ?? condition;
}

export function isToolCategory(value: string): value is ToolCategory {
  return (TOOL_CATEGORIES as readonly string[]).includes(value);
}

export function isToolCondition(value: string): value is ToolCondition {
  return (CONDITIONS as readonly string[]).includes(value);
}
