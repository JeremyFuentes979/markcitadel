import { useState } from "react";
import { BUSINESS_PRESETS, DEFAULT_CLASSES, NICE_CLASSES } from "@contracts/conflicts";
import { cn } from "@/lib/utils";

/** "What's your business?" → Nice classes, with optional fine-tuning. */
export function ClassPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (classes: number[]) => void;
}) {
  const [custom, setCustom] = useState(false);
  const key = [...value].sort((a, b) => a - b).join(",");
  const preset = BUSINESS_PRESETS.find((p) => [...p.classes].sort((a, b) => a - b).join(",") === key);

  return (
    <div className="text-sm">
      <label className="flex flex-wrap items-center gap-2 text-slate-600">
        <span className="font-medium text-slate-800">What's your business?</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          value={preset?.id ?? "custom"}
          onChange={(e) => {
            const p = BUSINESS_PRESETS.find((x) => x.id === e.target.value);
            if (p) onChange(p.classes);
            else setCustom(true);
          }}
        >
          {BUSINESS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom classes…</option>
        </select>
        <button
          type="button"
          className="text-xs text-navy-700 underline"
          onClick={() => setCustom(!custom)}
        >
          {custom ? "Hide classes" : `Classes ${value.join(", ")}`}
        </button>
      </label>
      {custom && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(NICE_CLASSES).map(([n, label]) => {
            const c = Number(n);
            const on = value.includes(c);
            return (
              <button
                key={n}
                type="button"
                title={label}
                onClick={() => {
                  const next = on ? value.filter((x) => x !== c) : [...value, c];
                  onChange(next.length ? next.sort((a, b) => a - b) : DEFAULT_CLASSES);
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  on ? "bg-navy-700 text-white border-navy-700" : "bg-white text-slate-600 border-slate-300 hover:border-navy-400",
                )}
              >
                {n} · {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

