"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { LoanCard } from "@/components/LoanCard";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  PageHeader,
  cx,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/categories";
import { errorMessage } from "@/lib/errors";

type Tab = "loans" | "listings" | "members";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "loans", label: "All loans" },
  { id: "listings", label: "Listings" },
  { id: "members", label: "Members" },
];

export default function AdminPage() {
  const viewer = useQuery(api.users.viewer);
  const isAdmin = viewer?.isAdmin === true;

  const loans = useQuery(api.loans.listAll, isAdmin ? {} : "skip");
  const tools = useQuery(api.tools.listAllForAdmin, isAdmin ? {} : "skip");
  const users = useQuery(api.users.list, isAdmin ? {} : "skip");

  const setTrusted = useMutation(api.users.setTrustedLender);
  const removeTool = useMutation(api.tools.remove);

  const [tab, setTab] = useState<Tab>("loans");
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (viewer === undefined) {
    return <p className="text-sm text-stone-500">Loading…</p>;
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admins only"
        description="This area is restricted by the Convex functions, not just by the navigation."
      />
    );
  }

  const overdue = loans?.filter((loan) => loan.isOverdue).length ?? 0;
  const activeListings = tools?.filter((tool) => tool.status === "active").length ?? 0;

  return (
    <div>
      <PageHeader
        title="Admin"
        description="Moderate listings, review every loan, and mark reliable neighbors as trusted lenders."
      />

      <div className="mb-5 flex flex-wrap gap-3 text-xs text-stone-500">
        <span>{loans?.length ?? 0} loans</span>
        <span>· {activeListings} active listings</span>
        <span>· {users?.length ?? 0} members</span>
        {overdue > 0 ? <span className="text-red-600">· {overdue} overdue</span> : null}
      </div>

      <div className="mb-5 flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition",
              tab === item.id
                ? "bg-stone-900 text-white"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {tab === "loans" ? (
        loans === undefined ? (
          <p className="text-sm text-stone-500">Loading loans…</p>
        ) : loans.length === 0 ? (
          <EmptyState title="No loans yet" description="Nothing has been requested so far." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {loans.map((loan) => (
              <LoanCard key={loan._id} loan={loan} perspective="admin" />
            ))}
          </div>
        )
      ) : null}

      {tab === "listings" ? (
        tools === undefined ? (
          <p className="text-sm text-stone-500">Loading listings…</p>
        ) : tools.length === 0 ? (
          <EmptyState title="No listings" description="Nobody has listed a tool yet." />
        ) : (
          <ul className="space-y-2">
            {tools.map((tool) => (
              <li key={tool._id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-stone-900">{tool.name}</h3>
                      {tool.status === "removed" ? <Badge>Removed</Badge> : <Badge tone="green">Active</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {categoryLabel(tool.category)} ·{" "}
                      {tool.owner ? (
                        <span>
                          {tool.owner.name}
                          {tool.owner.isTrustedLender ? " (trusted)" : ""}
                        </span>
                      ) : (
                        "unknown owner"
                      )}
                    </p>
                  </div>

                  {tool.status === "active" ? (
                    <ConfirmButton
                      label="Remove listing"
                      confirmLabel="Yes, remove"
                      onConfirm={() => run(() => removeTool({ toolId: tool._id }))}
                    />
                  ) : (
                    <span className="text-xs text-stone-400">Removed from the board</span>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "members" ? (
        users === undefined ? (
          <p className="text-sm text-stone-500">Loading members…</p>
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user._id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={user.name} url={user.imageUrl} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-stone-900">
                        <span className="truncate">{user.name}</span>
                        {user.role === "admin" ? <Badge tone="blue">Admin</Badge> : null}
                        {user.isTrustedLender ? <Badge tone="green">Trusted lender</Badge> : null}
                      </p>
                      <p className="truncate text-xs text-stone-500">{user.email}</p>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={user.isTrustedLender ? "secondary" : "primary"}
                    onClick={() =>
                      run(() =>
                        setTrusted({ userId: user._id, trusted: !user.isTrustedLender }),
                      )
                    }
                  >
                    {user.isTrustedLender ? "Revoke trusted" : "Mark as trusted"}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <p className="mt-6 text-xs text-stone-500">
        Admins can remove listings and review loans, but cannot edit other people&apos;s listings or
        act on their behalf — that separation is enforced inside the Convex mutations.
      </p>
    </div>
  );
}
