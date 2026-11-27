"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/categories";
import { errorMessage } from "@/lib/errors";
import {
  LOAN_STATUS_LABELS,
  activityLabel,
  formatRange,
  loanStatusTone,
  timeAgo,
} from "@/lib/format";
import type { LoanView } from "@/lib/types";
import { Badge, Button, Card } from "./ui";

type Perspective = "borrower" | "lender" | "admin";

function ActivityDot({ status }: { status: string }) {
  const color =
    status === "delivered" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : "bg-amber-500";
  return <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

export function LoanCard({ loan, perspective }: { loan: LoanView; perspective: Perspective }) {
  const decide = useMutation(api.loans.decide);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDecide = perspective === "lender" && loan.status === "pending";
  const canCancel = perspective === "borrower" && loan.status === "pending";
  const canClose =
    (perspective === "lender" || perspective === "borrower") && loan.status === "approved";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const counterpartLabel =
    perspective === "lender"
      ? loan.borrower?.name ?? "Neighbor"
      : perspective === "borrower"
        ? loan.owner?.name ?? "Neighbor"
        : `${loan.borrower?.name ?? "?"} → ${loan.owner?.name ?? "?"}`;

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-stone-900">
            {loan.tool?.name ?? "Removed listing"}
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            {loan.tool ? categoryLabel(loan.tool.category) : "Listing removed"} · {counterpartLabel}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={loanStatusTone(loan.status, loan.isOverdue)}>
            {loan.isOverdue ? `Overdue ${loan.daysOverdue}d` : LOAN_STATUS_LABELS[loan.status] ?? loan.status}
          </Badge>
          <span className="text-xs text-stone-500">{formatRange(loan.startDate, loan.endDate)}</span>
        </div>
      </div>

      {loan.note ? (
        <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
          &ldquo;{loan.note}&rdquo;
        </p>
      ) : null}

      {loan.recentActivity.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {loan.recentActivity.map((activity) => (
            <li key={activity._id} className="flex items-start gap-2 text-xs text-stone-500">
              <ActivityDot status={activity.status} />
              <span className="min-w-0">
                <span className="text-stone-600">{activityLabel(activity.type)}</span>
                <span className="text-stone-400"> · {timeAgo(activity.createdAt)}</span>
                {activity.status === "failed" && activity.detail ? (
                  <span className="block truncate text-red-500" title={activity.detail}>
                    {activity.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      {canDecide || canCancel || canClose ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
          {canDecide ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run(() => decide({ loanId: loan._id, decision: "approve" }))}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => decide({ loanId: loan._id, decision: "decline" }))}
              >
                Decline
              </Button>
            </>
          ) : null}

          {canCancel ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => cancel({ loanId: loan._id }))}
            >
              Cancel request
            </Button>
          ) : null}

          {canClose ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => markReturned({ loanId: loan._id }))}
            >
              Mark returned
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
