"use client";

import { useQuery } from "convex/react";

import { LoanCard } from "@/components/LoanCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

const PRIORITY: Record<string, number> = {
  pending: 0,
  approved: 1,
  returned: 2,
  declined: 3,
  cancelled: 4,
};

export default function IncomingPage() {
  const loans = useQuery(api.loans.listIncoming);

  const sorted = [...(loans ?? [])].sort((a, b) => {
    const byStatus = (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    return b.createdAt - a.createdAt;
  });

  const pending = sorted.filter((loan) => loan.status === "pending").length;
  const overdue = sorted.filter((loan) => loan.isOverdue).length;

  return (
    <div>
      <PageHeader
        title="Incoming requests"
        description="Approve or decline requests on your tools, then close the loop when the tool comes back."
      />

      {loans === undefined ? (
        <p className="text-sm text-stone-500">Loading incoming requests…</p>
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No incoming requests"
          description="When a neighbor asks to borrow one of your tools, it lands here and you get a notification through n8n."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-stone-500">
            <span>{sorted.length} total</span>
            {pending > 0 ? <span>· {pending} waiting on you</span> : null}
            {overdue > 0 ? <span className="text-red-600">· {overdue} overdue</span> : null}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {sorted.map((loan) => (
              <LoanCard key={loan._id} loan={loan} perspective="lender" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
