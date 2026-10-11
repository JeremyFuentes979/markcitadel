import { AlertTriangle, CircleCheck, ExternalLink, LoaderCircle, ShieldAlert, WifiOff } from "lucide-react";
import type { ConflictSummary } from "@contracts/conflicts";
import { cn } from "@/lib/utils";

const STYLES = {
  high: { box: "border-red-300 bg-red-50", title: "text-red-800", label: "High risk", Icon: ShieldAlert },
  possible: { box: "border-amber-300 bg-amber-50", title: "text-amber-900", label: "Possible conflict", Icon: AlertTriangle },
  clear: { box: "border-emerald-300 bg-emerald-50", title: "text-emerald-800", label: "Looks clear", Icon: CircleCheck },
  unknown: { box: "border-slate-300 bg-slate-50", title: "text-slate-800", label: "Unavailable", Icon: WifiOff },
} as const;

function word(s: string) {
  return s.toUpperCase();
}

/** The answer first: verdict, counts, who owns the word, top conflicts. */
export function VerdictCard({
  data,
  loading,
  error,
  maxConflicts = 10,
  footer,
}: {
  data?: ConflictSummary | null;
  loading?: boolean;
  error?: string | null;
  maxConflicts?: number;
  footer?: React.ReactNode;
}) {
  if (loading && !data) {
    return (
      <div className="rounded-2xl border bg-white p-5 flex items-center gap-3 text-slate-600">
        <LoaderCircle className="w-5 h-5 animate-spin text-navy-600" />
        Checking live marks, sound-alikes and your classes…
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-2xl border border-slate-300 bg-slate-50 p-5 text-sm text-slate-700">
        <strong>Couldn't run the conflict check.</strong> {error}
      </div>
    );
  }
  if (!data) return null;
  const st = STYLES[data.verdict];
  const c = data.counts;

  return (
    <div className={cn("rounded-2xl border-2 p-5", st.box)}>
      <div className="flex items-start gap-3">
        <st.Icon className={cn("w-7 h-7 shrink-0 mt-0.5", st.title)} />
        <div className="min-w-0 flex-1">
          <div className={cn("text-xs font-bold uppercase tracking-wider", st.title)}>{st.label}</div>
          <h2 className={cn("text-lg font-bold leading-snug", st.title)}>{data.headline}</h2>
          <p className="mt-1 text-sm text-slate-700">{data.explanation}</p>
        </div>
      </div>

      {data.verdict !== "unknown" && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Matching marks", c.total],
            ["Live", c.live],
            [`Live in classes ${data.classes.join(", ")}`, c.liveInYourClasses],
          ].map(([label, n]) => (
            <div key={String(label)} className="rounded-lg bg-white/70 border px-2 py-2">
              <div className="text-xl font-bold text-slate-900">{Number(n).toLocaleString()}</div>
              <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
            </div>
          ))}
        </div>
      )}

      {data.topOwners.length > 0 && (
        <div className="mt-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900 mb-1">Who owns this word</div>
          <ul className="space-y-0.5">
            {data.topOwners.slice(0, 4).map((o) => (
              <li key={o.owner}>
                <strong>{o.owner}</strong> owns {o.liveMarks} live {word(data.query)}-type mark
                {o.liveMarks === 1 ? "" : "s"}
                {o.classes.length > 0 && <span className="text-slate-500"> (classes {o.classes.slice(0, 6).join(", ")})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.topConflicts.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-slate-900 mb-2">Top conflicts</div>
          <ol className="space-y-2">
            {data.topConflicts.slice(0, maxConflicts).map((m) => (
              <li key={m.serialNumber} className="rounded-lg bg-white border px-3 py-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "text-[11px] font-bold rounded px-1.5 py-0.5",
                      m.score >= 75 ? "bg-red-100 text-red-700" : m.score >= 40 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {m.score}
                  </span>
                  <span className="font-semibold text-slate-900">{m.wordmark}</span>
                  <span className="text-slate-500 truncate">{m.owner}</span>
                  <a href={m.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-navy-700 inline-flex items-center gap-1">
                    SN {m.serialNumber} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="mt-0.5 text-xs text-slate-600">{m.reasons.join(" · ")}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.degraded && <p className="mt-3 text-xs text-amber-800">{data.degraded}</p>}
      {footer}
      <p className="mt-3 text-[11px] text-slate-500">{data.disclaimer}</p>
    </div>
  );
}
