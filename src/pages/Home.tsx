import { useNavigate } from "react-router";
import { Link } from "react-router";
import {
  Tag,
  FileText,
  Plug,
  Bot,
  Building2,
  Globe,
  ArrowRight,
  BadgeCheck,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { SearchBar } from "@/components/SearchBar";
import { CodeBlock } from "@/components/CodeBlock";
import type { SearchType } from "@contracts/types";

export default function Home() {
  const navigate = useNavigate();
  const go = (q: string, type: SearchType) =>
    navigate(`/search?q=${encodeURIComponent(q)}&type=${type}`);

  return (
    <Layout>
      {/* Hero */}
      <section className="bg-gradient-to-b from-navy-50/80 via-white to-white">
        <div className="max-w-3xl mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-6">
            <Globe className="w-3.5 h-3.5" />
            Live data from the USPTO
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight leading-tight">
            Search U.S. patents &amp; trademarks.
            <br />
            <span className="text-brass-500">Built for humans and AI.</span>
          </h1>
          <p className="mt-5 text-lg text-slate-600 max-w-xl mx-auto">
            One simple search over millions of federal trademark registrations
            and patent documents — plus an open API your website, startup tool,
            or AI agent can plug into.
          </p>
          <div className="mt-8">
            <SearchBar large onSearch={go} initialType="trademarks" />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm">
            <span className="text-slate-400">Try:</span>
            {[
              { q: "nike", t: "trademarks" as SearchType, label: "nike (mark)" },
              {
                q: "tesla",
                t: "trademarks" as SearchType,
                label: "tesla (mark)",
              },
              {
                q: "drone delivery",
                t: "patents" as SearchType,
                label: "drone delivery (patent)",
              },
              {
                q: "quantum.ti.",
                t: "patents" as SearchType,
                label: "quantum.ti. (title)",
              },
            ].map((ex) => (
              <button
                key={ex.label}
                onClick={() => go(ex.q, ex.t)}
                className="text-navy-600 hover:text-navy-800 hover:underline"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-14">
        <div className="grid md:grid-cols-3 gap-5">
          <Link to="/namecheck" className="bg-white border border-navy-200 rounded-2xl p-6 hover:border-navy-400 hover:shadow-md transition-all block">
            <div className="w-10 h-10 rounded-lg bg-navy-800 text-brass-300 flex items-center justify-center mb-4">
              <BadgeCheck className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg">
              Name check
            </h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              The full clearance run before you commit to a name — live USPTO
              trademarks, exact-match domains, sound-alike brands, plus guided
              checks for state registries, social handles, and international
              conflicts.
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-navy-700">
              Check a name <ArrowRight className="w-4 h-4" />
            </span>
          </Link>
          <div className="bg-white border rounded-2xl p-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Tag className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg">
              Trademark availability
            </h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Check a business or brand name against every live and dead federal
              trademark — by text, or upload a logo to find visually similar
              marks with USPTO's image search. See the owner, status, classes,
              and goods &amp; services before you file an LLC or launch a
              product.
            </p>
          </div>
          <div className="bg-white border rounded-2xl p-6">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center mb-4">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg">
              Patent prior-art search
            </h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Search the full USPTO collection of granted patents and published
              applications with the same query language patent examiners use —
              titles, abstracts, applicants, inventors, and more.
            </p>
          </div>
          <div className="bg-white border rounded-2xl p-6">
            <div className="w-10 h-10 rounded-lg bg-navy-100 text-navy-700 flex items-center justify-center mb-4">
              <Plug className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg">
              A connector, not just a website
            </h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              Every search is also a clean JSON API with an OpenAPI spec — so
              AI agents, domain-registrars, and LLC-formation flows can call it
              directly.
            </p>
          </div>
        </div>
      </section>

      {/* Connector section */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="bg-slate-950 rounded-3xl p-8 md:p-12 text-white">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold">
                Plug it into anything
              </h2>
              <p className="mt-4 text-slate-300 leading-relaxed">
                Two GET endpoints return normalized JSON for both patents and
                trademarks. No API key, CORS open — call it from your backend,
                your no-code tool, or hand the OpenAPI spec to an AI agent.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                <li className="flex gap-3">
                  <Building2 className="w-5 h-5 text-navy-400 shrink-0" />
                  <span>
                    LLC &amp; startup formation sites can name-check every
                    registration against live USPTO trademark data.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Globe className="w-5 h-5 text-navy-400 shrink-0" />
                  <span>
                    Domain and branding tools can warn about conflicts before a
                    customer buys a name.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Bot className="w-5 h-5 text-navy-400 shrink-0" />
                  <span>
                    AI agents can fetch <code>/api/v1/openapi.json</code> and
                    start searching immediately.
                  </span>
                </li>
              </ul>
              <Link
                to="/developers"
                className="mt-7 inline-flex items-center gap-2 text-sm font-medium bg-white text-slate-900 rounded-lg px-4 py-2.5 hover:bg-slate-200 transition-colors"
              >
                Read the API docs <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <CodeBlock
              language="curl"
              code={`# Is this brand name taken?
curl "${
                typeof window !== "undefined" ? window.location.origin : ""
              }/api/v1/trademarks/search?q=acme&status=live"

# Search patents
curl "${
                typeof window !== "undefined" ? window.location.origin : ""
              }/api/v1/patents/search?q=drone%20delivery"`}
            />
          </div>
        </div>
      </section>
    </Layout>
  );
}
