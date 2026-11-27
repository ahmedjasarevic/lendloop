"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { FilterChips } from "@/components/FilterChips";
import { RequestDialog } from "@/components/RequestDialog";
import { Avatar, Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  TOOL_CATEGORIES,
  categoryLabel,
  conditionLabel,
} from "@/convex/lib/categories";
import { formatDay } from "@/lib/format";
import type { ToolView } from "@/lib/types";

export default function BrowsePage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const tools = useQuery(api.tools.listAvailable, isAuthenticated ? {} : "skip");

  const [category, setCategory] = useState("all");
  const [requestTool, setRequestTool] = useState<ToolView | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tool of tools ?? []) {
      map.set(tool.category, (map.get(tool.category) ?? 0) + 1);
    }
    return map;
  }, [tools]);

  const visible = useMemo(() => {
    if (!tools) return [];
    if (category === "all") return tools;
    return tools.filter((tool) => tool.category === category);
  }, [tools, category]);

  if (!isLoading && !isAuthenticated) {
    return (
      <EmptyState
        title="Sign in to see the board"
        description="Owner names, conditions and request buttons are only available to signed-in neighbors."
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="The board"
        description={`${tools?.length ?? 0} tools shared by your neighbors. Availability updates as loans are approved.`}
      />

      <FilterChips
        value={category}
        onChange={setCategory}
        options={[
          { value: "all", label: "All", count: tools?.length ?? 0 },
          ...TOOL_CATEGORIES.map((value) => ({
            value,
            label: CATEGORY_LABELS[value],
            count: counts.get(value) ?? 0,
          })),
        ]}
      />

      <div className="mt-5">
        {tools === undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-44 animate-pulse rounded-2xl border border-stone-200 bg-white"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title={tools.length === 0 ? "No tools yet" : "Nothing in this category"}
            description={
              tools.length === 0
                ? "The board is empty. Add the first tool from “My listings”."
                : "Try another category, or list something yourself."
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((tool) => (
              <li key={tool._id}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-stone-900">{tool.name}</h3>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
                      </p>
                    </div>
                    <Badge tone={tool.isOverdue ? "red" : tool.onLoanUntil ? "amber" : "green"}>
                      {tool.isOverdue
                        ? "Overdue"
                        : tool.onLoanUntil
                          ? `Back ${formatDay(tool.onLoanUntil)}`
                          : "Available"}
                    </Badge>
                  </div>

                  <p className="mt-3 flex-1 text-sm leading-relaxed text-stone-600">
                    {tool.description}
                  </p>

                  {tool.nextBookingStart ? (
                    <p className="mt-2 text-xs text-stone-500">
                      Next booking starts {formatDay(tool.nextBookingStart)}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-stone-600">
                      <Avatar
                        name={tool.owner?.name ?? "Neighbor"}
                        url={tool.owner?.imageUrl}
                      />
                      <span className="truncate">{tool.owner?.name ?? "Neighbor"}</span>
                      {tool.owner?.isTrustedLender ? <Badge tone="green">Trusted</Badge> : null}
                    </span>

                    {tool.isMine ? (
                      <span className="shrink-0 text-xs text-stone-400">Your listing</span>
                    ) : (
                      <Button size="sm" onClick={() => setRequestTool(tool)}>
                        Request
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {requestTool ? (
        <RequestDialog
          toolId={requestTool._id}
          toolName={requestTool.name}
          onClose={() => setRequestTool(null)}
        />
      ) : null}
    </div>
  );
}
