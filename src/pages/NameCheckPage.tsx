import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  BadgeCheck,
  Building2,
  CircleCheck,
  CircleX,
  Globe,
  Landmark,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  MinusCircle,
  Search,
  Volume2,
  Earth,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { cn } from "@/lib/utils";
import { ReportCTA } from "@/components/ReportCTA";
import { AttorneyLeadForm } from "@/components/AttorneyLeadForm";
import { ClassPicker } from "@/components/ClassPicker";
import { parseClassesParam } from "@contracts/conflicts";
import { VerdictCard } from "@/components/VerdictCard";

// ─── Checklist item shells ──────────────────────────────────────────────────

type Verdict = "pass" | "warn" | "fail" | "loading" | "manual" | "idle";

function VerdictIcon({ v }: { v: Verdict }) {
  if (v === "loading")
    return <LoaderCircle className="w-5 h-5 text-slate-400 animate-spin" />;
  if (v === "pass") return <CircleCheck className="w-5 h-5 text-emerald-600" />;
  if (v === "fail") return <CircleX className="w-5 h-5 text-red-500" />;
  if (v === "warn") return <MinusCircle className="w-5 h-5 text-amber-500" />;
  if (v === "manual")
    return <MinusCircle className="w-5 h-5 text-slate-300" />;
  return <MinusCircle className="w-5 h-5 text-slate-200" />;
}

function Row({
  icon: Icon,
  title,
  verdict,
  children,
  manual,
  checked,
  onToggle,
}: {
  icon: React.ElementType;
  title: string;
  verdict: Verdict;
  children: React.ReactNode;
  manual?: boolean;
  checked?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 flex gap-4">
      {manual ? (
        <button
          onClick={onToggle}
          className="shrink-0 pt-0.5"
          title={checked ? "Mark not done" : "Mark done"}
        >
          {checked ? (
            <CircleCheck className="w-5 h-5 text-emerald-600" />
          ) : (
            <MinusCircle className="w-5 h-5 text-slate-300 hover:text-slate-500 transition-colors" />
          )}
        </button>
      ) : (
        <div className="shrink-0 pt-0.5">
          <VerdictIcon v={verdict} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-semibold text-slate-900">
          <Icon className="w-4 h-4 text-navy-600" />
          {title}
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-600 space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-navy-700 underline hover:text-navy-900"
    >
      {children}
    </a>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

const MANUAL_KEYS = ["state", "handles", "companies", "google", "intl"] as const;
type ManualKey = (typeof MANUAL_KEYS)[number];

export default function NameCheckPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("name") ?? "";
  const classes = parseClassesParam(params.get("classes"));
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const [done, setDone] = useState<Record<ManualKey, boolean>>({
    state: false,
    handles: false,
    companies: false,
    google: false,
    intl: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const check = trpc.search.nameCheck.useQuery(
    { name: submitted, classes },
    { enabled: submitted.trim().length >= 2, retry: false },
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = () => {
    const n = value.trim();
    if (n.length < 2) return;
    setSubmitted(n);
    setParams({ name: n, classes: classes.join(",") }, { replace: true });
    setDone({ state: false, handles: false, companies: false, google: false, intl: false });
  };

  const d = check.data;
  const loading = check.isFetching && submitted.length >= 2;
  const liveMarks = d?.liveMarks ?? -1;
  const domains = d?.domains ?? [];
  const soundAlikes = d?.soundAlikes ?? [];
  const exactCom = domains.find((x) => x.domain.endsWith(".com"));
  const enc = encodeURIComponent(submitted);

  const tmVerdict: Verdict = !submitted
    ? "idle"
    : loading
      ? "loading"
      : liveMarks < 0 || !d?.conflicts
        ? "warn"
        : d.conflicts.verdict === "clear"
          ? "pass"
          : d.conflicts.verdict === "high"
            ? "fail"
            : "warn";

  const domVerdict: Verdict = !submitted
    ? "idle"
    : loading
      ? "loading"
      : !domains.length
        ? "warn"
        : exactCom?.status === "available"
          ? "pass"
          : exactCom?.status === "taken"
            ? "warn"
            : "warn";

  const soundVerdict: Verdict = !submitted
    ? "idle"
    : loading
      ? "loading"
      : soundAlikes.length === 0
        ? "pass"
        : "warn";

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-4">
          <BadgeCheck className="w-3.5 h-3.5" /> Name clearance
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Check a name before you commit to it
        </h1>
        <p className="mt-3 text-slate-600">
          The eight checks that matter before trademarking, incorporating, or
          printing business cards. Three are answered live; five link you to
          the right place to check.
        </p>

        <div className="mt-6 flex gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Enter a business or brand name…"
            className="text-base h-12"
          />
          <Button
            onClick={run}
            disabled={value.trim().length < 2 || loading}
            className="h-12 px-6 bg-navy-700 hover:bg-navy-800"
          >
            {loading ? (
              <LoaderCircle className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Check
          </Button>
        </div>

        {submitted && d?.degraded && (
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {d.degraded}
          </div>
        )}

        <div className="mt-3">
          <ClassPicker
            value={classes}
            onChange={(c) => {
              const next = new URLSearchParams(params);
              next.set("classes", c.join(","));
              setParams(next, { replace: true });
            }}
          />
        </div>

        {submitted && (
          <div className="mt-6">
            <VerdictCard
              data={d?.conflicts}
              loading={loading}
              error={check.error?.message}
              maxConflicts={5}
              footer={
                d?.conflicts && d.conflicts.verdict !== "unknown" ? (
                  <p className="mt-3 text-xs text-slate-600">
                    Showing the top 5. The paid report lists up to 10 scored marks with owners,
                    registration numbers and classes.{" "}
                    <Link to={`/search?q=${enc}&type=trademarks&status=live&classes=${classes.join(",")}`} className="underline text-navy-700">
                      Browse all live results
                    </Link>
                  </p>
                ) : null
              }
            />
          </div>
        )}

        {submitted && (
          <div className="mt-8 space-y-4">
            {/* 1. USPTO trademark */}
            <Row icon={Landmark} title="USPTO trademark search" verdict={tmVerdict}>
              {liveMarks >= 0 ? (
                <p>
                  <strong>
                    {liveMarks === 0
                      ? "No live marks matching this name."
                      : `${liveMarks.toLocaleString()} live trademark${liveMarks === 1 ? "" : "s"} match "${submitted}".`}
                  </strong>{" "}
                  {liveMarks > 0 && (
                    <>
                      That doesn't automatically block you — but review them
                      before spending money.{" "}
                    </>
                  )}
                  <Link
                    to={`/search?q=${enc}&type=trademarks`}
                    className="text-navy-700 underline"
                  >
                    See the marks →
                  </Link>
                </p>
              ) : (
                <p>
                  Couldn't reach USPTO right now —{" "}
                  <Link
                    to={`/search?q=${enc}&type=trademarks`}
                    className="text-navy-700 underline"
                  >
                    try the full search
                  </Link>
                  .
                </p>
              )}
            </Row>

            {/* 2. State business registrations */}
            <Row
              icon={MapPin}
              title="State business registrations"
              verdict="manual"
              manual
              checked={done.state}
              onToggle={() => setDone({ ...done, state: !done.state })}
            >
              <p>
                Trademarks and business-entity names are separate systems —
                your state can register an LLC name that's already trademarked
                by someone else (and vice versa). Check your Secretary of
                State's business search:
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Ext href="https://opencorporates.com/">OpenCorporates (all states)</Ext>
                <Ext href="https://www.nass.org/business-services/corporate-registration">
                  Find your state's registry
                </Ext>
              </div>
            </Row>

            {/* 3. Exact-match domains */}
            <Row icon={Globe} title="Exact-match domains" verdict={domVerdict}>
              {domains.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {domains.map((x) => (
                    <span
                      key={x.domain}
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
                        x.status === "available" &&
                          "bg-emerald-50 text-emerald-700 border-emerald-200",
                        x.status === "taken" &&
                          "bg-red-50 text-red-600 border-red-200",
                        x.status === "unknown" &&
                          "bg-slate-50 text-slate-500 border-slate-200",
                      )}
                    >
                      {x.status === "available" ? (
                        <CircleCheck className="w-3 h-3" />
                      ) : x.status === "taken" ? (
                        <CircleX className="w-3 h-3" />
                      ) : (
                        <MinusCircle className="w-3 h-3" />
                      )}
                      {x.domain}
                    </span>
                  ))}
                </div>
              ) : (
                <p>Run a check to see domain availability.</p>
              )}
              {exactCom?.status === "taken" && (
                <p className="text-slate-500">
                  The .com is taken. Alternatives (.io, .ai) work for tech, but
                  a taken .com with an active site in your industry is a real
                  conflict risk.
                </p>
              )}
            </Row>

            {/* 4. Social handles */}
            <Row
              icon={MessageSquareText}
              title="Social handles"
              verdict="manual"
              manual
              checked={done.handles}
              onToggle={() => setDone({ ...done, handles: !done.handles })}
            >
              <p>
                Consistent handles matter for brand trust. Check the ones your
                customers actually use:
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Ext href={`https://x.com/${enc}`}>X</Ext>
                <Ext href={`https://instagram.com/${enc}`}>Instagram</Ext>
                <Ext href={`https://linkedin.com/company/${enc}`}>LinkedIn</Ext>
                <Ext href={`https://tiktok.com/@${enc}`}>TikTok</Ext>
                <Ext href={`https://youtube.com/@${enc}`}>YouTube</Ext>
              </div>
            </Row>

            {/* 5. Existing companies */}
            <Row
              icon={Building2}
              title="Existing companies using the name"
              verdict="manual"
              manual
              checked={done.companies}
              onToggle={() => setDone({ ...done, companies: !done.companies })}
            >
              <p>
                An unregistered company trading under the name can still have
                common-law rights where it operates. Search business databases:
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Ext href={`https://opencorporates.com/companies?q=${enc}`}>
                  OpenCorporates
                </Ext>
                <Ext href={`https://www.crunchbase.com/search/organizations/field/organizations/name/${enc}`}>
                  Crunchbase
                </Ext>
                <Ext href={`https://www.linkedin.com/search/results/companies/?keywords=${enc}`}>
                  LinkedIn companies
                </Ext>
              </div>
            </Row>

            {/* 6. Google search */}
            <Row
              icon={Search}
              title="Google the name"
              verdict="manual"
              manual
              checked={done.google}
              onToggle={() => setDone({ ...done, google: !done.google })}
            >
              <p>
                The catch-all: news mentions, app-store listings, products,
                slang meanings, or a scandal you don't want to be confused
                with. Search the name alone, and the name + your industry.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Ext href={`https://www.google.com/search?q=%22${enc}%22`}>
                  "{submitted}" exact
                </Ext>
                <Ext href={`https://www.google.com/search?q=${enc}+company`}>
                  {submitted} + company
                </Ext>
                <Ext href={`https://www.google.com/search?q=${enc}+brand`}>
                  {submitted} + brand
                </Ext>
              </div>
            </Row>

            {/* 7. Similar-sounding brands */}
            <Row icon={Volume2} title="Similar-sounding brands" verdict={soundVerdict}>
              {soundAlikes.length > 0 ? (
                <>
                  <p>
                    Registration is refused for marks that <em>sound</em> alike,
                    not just look alike. Search these phonetic variants too:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {soundAlikes.map((s) => (
                      <Link
                        key={s}
                        to={`/search?q=${encodeURIComponent(s)}&type=trademarks`}
                        className="text-xs font-medium px-2.5 py-1 rounded-full border border-navy-200 text-navy-700 hover:bg-navy-50"
                      >
                        {s}
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <p>
                  {submitted
                    ? "No common phonetic variants generated — this name is fairly distinctive in spelling."
                    : "Run a check to generate sound-alike spellings."}
                </p>
              )}
            </Row>

            {/* 8. International conflicts */}
            <Row
              icon={Earth}
              title="International conflicts (if you'll expand)"
              verdict="manual"
              manual
              checked={done.intl}
              onToggle={() => setDone({ ...done, intl: !done.intl })}
            >
              <p>
                USPTO only covers the US. If you might sell abroad, check the
                Madrid system and the big jurisdictions before printing
                packaging:
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Ext href="https://branddb.wipo.int/en/">WIPO Global Brand Database</Ext>
                <Ext href="https://www.tmdn.org/tmview/">TMview (EU/UK + partners)</Ext>
                <Ext href="https://trademarks.seek.in/ipo/uk">UK IPO search</Ext>
              </div>
            </Row>

            {/* Verdict footer */}
            <div className="rounded-2xl border border-navy-200 bg-navy-50 p-5 text-sm text-navy-900">
              <strong>Bottom line:</strong> a name is "clear" when all eight
              are quiet — no live USPTO conflicts, the .com is available (or
              parked), no one is trading under it in your space, and it sounds
              unique. Any red flag here is cheap to fix now and expensive
              later. When you're ready:{" "}
              <Link to="/register-help" className="underline font-medium">
                how to register it
              </Link>
              .
            </div>

            <ReportCTA name={submitted} classes={classes} />
            <AttorneyLeadForm businessName={submitted} />
            <p className="text-xs text-slate-500">
              MarkCitadel is an information tool, not a law firm. Results are a
              preliminary screening and are not legal advice.
            </p>
          </div>
        )}

        {!submitted && (
          <p className="mt-6 text-sm text-slate-500">
            Tip: this complements the full{" "}
            <Link to="/" className="text-navy-700 underline">
              trademark search
            </Link>{" "}
            — that shows you every mark; this tells you what it all means.
          </p>
        )}
      </div>
    </Layout>
  );
}
