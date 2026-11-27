"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatRange } from "@/lib/format";
import { Button, Field, Input, Textarea } from "./ui";

function isoDay(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function RequestDialog({
  toolId,
  toolName,
  onClose,
}: {
  toolId: Id<"tools">;
  toolName: string;
  onClose: () => void;
}) {
  const requestLoan = useMutation(api.loans.request);

  const [startDate, setStartDate] = useState(isoDay(0));
  const [endDate, setEndDate] = useState(isoDay(3));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestLoan({ toolId, startDate, endDate, note: note.trim() || undefined });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl">
        {sent ? (
          <div className="space-y-4">
            <div>
              <h2 id="request-title" className="text-lg font-semibold text-stone-900">
                Request sent
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                {toolName} · {formatRange(startDate, endDate)}
              </p>
            </div>
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Request sent. The lender will be notified and can approve or decline. You can track
              the status under &quot;My requests&quot;.
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h2 id="request-title" className="text-lg font-semibold text-stone-900">
                Request to borrow
              </h2>
              <p className="mt-1 text-sm text-stone-600">{toolName}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Pick up">
                <Input
                  type="date"
                  value={startDate}
                  min={isoDay(0)}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (event.target.value > endDate) setEndDate(event.target.value);
                  }}
                  required
                />
              </Field>
              <Field label="Return">
                <Input
                  type="date"
                  value={endDate}
                  min={startDate || isoDay(0)}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="Note to the lender" hint="optional">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="I need it for a shelf build on Saturday. I can pick it up Friday evening."
                maxLength={280}
                className="min-h-20"
              />
            </Field>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
