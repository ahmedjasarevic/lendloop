"use client";

import { useQuery } from "convex/react";

import { LoanCard } from "@/components/LoanCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

const HISTORY = new Set(["returned", "declined", "cancelled"]);

export default function MyRequestsPage() {
  const loans = useQuery(api.loans.listMine);

  const active = (loans ?? []).filter((loan) => !HISTORY.has(loan.status));
  const history = (loans ?? []).filter((loan) => HISTORY.has(loan.status));

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Everything you asked to borrow, with the automation trail for each loan."
      />

      {loans === undefined ? (
        <p className="text-sm text-stone-500">Loading your requests…</p>
      ) : loans.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Find something on the board and ask for the days you need it. The lender gets notified immediately."
        />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
              Open ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-stone-500">Nothing open right now.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {active.map((loan) => (
                  <LoanCard key={loan._id} loan={loan} perspective="borrower" />
                ))}
              </div>
            )}
          </section>

          {history.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
                History ({history.length})
              </h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {history.map((loan) => (
                  <LoanCard key={loan._id} loan={loan} perspective="borrower" />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
