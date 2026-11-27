"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  TOOL_CATEGORIES,
  type ToolCategory,
  type ToolCondition,
} from "@/convex/lib/categories";
import { errorMessage } from "@/lib/errors";
import { Button, Field, Input, Select, Textarea } from "./ui";

type ToolFormProps = {
  initial?: {
    _id: Id<"tools">;
    name: string;
    category: string;
    condition: string;
    description: string;
  } | null;
  onDone: () => void;
  onCancel: () => void;
};

export function ToolForm({ initial, onDone, onCancel }: ToolFormProps) {
  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);

  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<ToolCategory>(
    (initial?.category as ToolCategory) ?? "power-tools",
  );
  const [condition, setCondition] = useState<ToolCondition>(
    (initial?.condition as ToolCondition) ?? "good",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await updateTool({ toolId: initial._id, name, category, condition, description });
      } else {
        await createTool({ name, category, condition, description });
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tool name" hint="What would a neighbor search for?">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Cordless drill"
            maxLength={80}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value as ToolCategory)}
            >
              {TOOL_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Condition">
            <Select
              value={condition}
              onChange={(event) => setCondition(event.target.value as ToolCondition)}
            >
              {CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {CONDITION_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <Field label="Description" hint={`${description.length}/500`}>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="18V drill with two batteries and a bit set. Please return the bits in the case."
          maxLength={500}
          required
        />
      </Field>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save changes" : "List this tool"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
