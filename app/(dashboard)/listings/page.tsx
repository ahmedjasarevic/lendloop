"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { ToolForm } from "@/components/ToolForm";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel, conditionLabel } from "@/convex/lib/categories";
import { errorMessage } from "@/lib/errors";
import type { MyToolView } from "@/lib/types";

export default function MyListingsPage() {
  const tools = useQuery(api.tools.listMine);
  const removeTool = useMutation(api.tools.remove);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MyToolView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCount = tools?.filter((tool) => tool.status === "active").length ?? 0;

  return (
    <div>
      <PageHeader
        title="My listings"
        description={`${activeCount} active ${activeCount === 1 ? "listing" : "listings"}. You can edit or remove anything you own.`}
        action={
          <Button
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
          >
            List a tool
          </Button>
        }
      />

      {creating ? (
        <Card className="mb-4 p-5">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">New listing</h2>
          <ToolForm
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </Card>
      ) : null}

      {editing ? (
        <Card className="mb-4 p-5">
          <h2 className="mb-4 text-sm font-semibold text-stone-900">Edit “{editing.name}”</h2>
          <ToolForm
            initial={{
              _id: editing._id,
              name: editing.name,
              category: editing.category,
              condition: editing.condition,
              description: editing.description,
            }}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {tools === undefined ? (
        <p className="text-sm text-stone-500">Loading your listings…</p>
      ) : tools.length === 0 ? (
        <EmptyState
          title="You have not listed anything yet"
          description="A drill, a ladder, a pasta machine. Add one and it appears on the board immediately."
          action={<Button onClick={() => setCreating(true)}>List your first tool</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {tools.map((tool) => (
            <li key={tool._id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-stone-900">{tool.name}</h3>
                    {tool.status === "removed" ? (
                      <Badge>Removed</Badge>
                    ) : tool.pendingRequests > 0 ? (
                      <Badge tone="amber">
                        {tool.pendingRequests} pending{" "}
                        {tool.pendingRequests === 1 ? "request" : "requests"}
                      </Badge>
                    ) : (
                      <Badge tone="green">Active</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {categoryLabel(tool.category)} · {conditionLabel(tool.condition)}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {tool.status === "active" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(tool);
                        setCreating(false);
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}

                  {tool.status === "active" ? (
                    <ConfirmButton
                      label="Remove"
                      confirmLabel="Yes, remove"
                      onConfirm={async () => {
                        setError(null);
                        try {
                          await removeTool({ toolId: tool._id });
                        } catch (err) {
                          setError(errorMessage(err));
                        }
                      }}
                    />
                  ) : (
                    <span className="px-2 text-xs text-stone-400">Hidden from the board</span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-stone-500">
        Removing a listing keeps its loan history intact and automatically declines pending
        requests, so nobody is left waiting on a tool that is gone.
      </p>
    </div>
  );
}
