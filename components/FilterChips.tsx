"use client";

import { cx } from "./ui";

export function FilterChips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; count?: number }>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded-full px-3 py-1.5 text-xs font-medium transition",
              active
                ? "bg-stone-900 text-white"
                : "border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-900",
            )}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className={cx("ml-1.5", active ? "text-stone-300" : "text-stone-400")}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
