import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  FileText,
  Scale,
  Search,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CLEARANCE_EXAMPLES,
  nameToSlug,
} from "@/data/clearance";

const REPORT_PRICE = 29;

export default function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const check = (raw: string) => {
    const n = raw.trim();
    if (n.length < 2) return;
    navigate(`/namecheck?name=${encodeURIComponent(n)}`);
  };

  return (
    <Layout>
      <Seo
        title="Check a business name before you commit"
        description="Free USPTO name check for live trademarks, the .com, and sound-alike brands. $29 for the PDF you hand a partner or attorney. Not legal advice."
        path="/"
      />

      <section className="bg-gradient-to-b from-navy-50/80 via-white to-white">
        <div className="max-w-3xl mx-auto px-4 pt-16 pb-12 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-6">
            <BadgeCheck className="w-3.5 h-3.5" />
            Free to check · ${REPORT_PRICE} written report
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight leading-tight">
            Check your business name before you print the truck wrap.
          </h1>
          <p className="mt-5 text-lg text-slate-600 max-w-xl mx-auto">
            Live federal trademarks, the exact-match .com, and brands that
            sound like yours. Free to screen. ${REPORT_PRICE} for the PDF you
            hand your partner or a trademark attorney.
          </p>
          <form
            className="mt-8 flex flex-col sm:flex-row gap-2 max-w-xl mx-auto"
            onSubmit={(e) => {
              e.preventDefault();
              check(name);
            }}
          >
            <label htmlFor="business-name" className="sr-only">
              Business or brand name
            </label>
            <Input
              id="business-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Business or brand name"
              className="h-12 text-base min-w-0 flex-1"
              autoFocus
            />
            <Button
              type="submit"
              className="h-12 px-5 bg-navy-800 hover:bg-navy-900"
              disabled={name.trim().length < 2}
            >
              Check this name
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Not legal advice. A preliminary screen of public USPTO records.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-6">
        <div className="grid md:grid-cols-3 gap-5">
          <div className="rounded-2xl border bg-white p-6">
            <div className="w-10 h-10 rounded-lg bg-navy-800 text-brass-300 flex items-center justify-center mb-4">
              <Search className="w-5 h-5" />
            </div>
            <h2 className="font-semibold text-slate-900">1. Check it free</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              See the risk verdict, who already owns the word, live mark
              counts, domain status, and sound-alike spellings.
            </p>
          </div>
          <div className="rounded-2xl border-2 border-navy-700 bg-white p-6">
            <div className="w-10 h-10 rounded-lg bg-brass-400 text-navy-900 flex items-center justify-center mb-4">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="font-semibold text-slate-900">
              2. Unlock the ${REPORT_PRICE} report
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Up to 10 scored conflicts with owners and serial numbers, plus
              a one-page PDF. One-time Stripe payment. No subscription.
            </p>
          </div>
          <div className="rounded-2xl border bg-white p-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Scale className="w-5 h-5" />
            </div>
            <h2 className="font-semibold text-slate-900">
              3. Ask an attorney if it is close
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Request an introduction to an independent trademark attorney.
              MarkCitadel may receive a referral fee. They decide whether you
              should file.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex items-end justify-between gap-4 mb-5">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              Is this name trademarked?
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Open a name, run the live screen, and buy the report only if you
              still want it.
            </p>
          </div>
          <Link
            to="/namecheck"
            className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-navy-700 hover:underline"
          >
            Check any name <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CLEARANCE_EXAMPLES.slice(0, 9).map((ex) => (
            <Link
              key={ex.name}
              to={`/is/${nameToSlug(ex.name)}`}
              className="rounded-xl border bg-white px-4 py-3 hover:border-navy-400 hover:shadow-sm transition-all"
            >
              <div className="font-medium text-slate-900">{ex.name}</div>
              <div className="text-xs text-slate-500 mt-0.5 capitalize">
                {ex.kind} · see the screen
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="rounded-3xl bg-slate-950 text-white p-8 md:p-10 flex flex-wrap items-center gap-6">
          <div className="flex-1 min-w-64">
            <h2 className="text-2xl font-bold">
              Building a site, an LLC tool, or an AI agent?
            </h2>
            <p className="mt-2 text-slate-300 text-sm leading-relaxed">
              The same name check is a JSON API and an MCP connector. The
              website stays free. API plans are for software that calls it
              all day.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/developers"
              className="inline-flex items-center gap-2 text-sm font-medium bg-white text-slate-900 rounded-lg px-4 py-2.5 hover:bg-slate-200"
            >
              API docs <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 text-sm font-medium rounded-lg px-4 py-2.5 border border-slate-600 hover:bg-slate-900"
            >
              API pricing
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
