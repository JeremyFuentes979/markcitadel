import { Link, useParams } from "react-router";
import { BadgeCheck } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Seo } from "@/components/Seo";
import { VerdictCard } from "@/components/VerdictCard";
import { ReportCTA } from "@/components/ReportCTA";
import { AttorneyLeadForm } from "@/components/AttorneyLeadForm";
import { trpc } from "@/providers/trpc";
import { DEFAULT_CLASSES } from "@contracts/conflicts";
import {
  displayNameForSlug,
  exampleBySlug,
  pageCopy,
  relatedExamples,
} from "@/data/clearance";
import NotFound from "./NotFound";

/** Public "Is [name] trademarked?" page. Curated URLs are prerendered for search. */
export default function IsTrademarkedPage() {
  const { slug = "" } = useParams();
  const name = displayNameForSlug(slug);
  const known = name ? exampleBySlug(slug) : null;
  const copy = pageCopy(name ?? "this name", known?.kind);
  const related = relatedExamples(slug);
  const check = trpc.search.nameCheck.useQuery(
    { name: name ?? "x", classes: DEFAULT_CLASSES },
    { enabled: !!name && name.length >= 2, retry: false },
  );
  if (!name) return <NotFound />;

  return (
    <Layout>
      <Seo
        title={copy.title}
        description={copy.description}
        path={`/is/${slug}`}
        faqs={copy.faqs}
      />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-navy-700 bg-navy-100 rounded-full px-3 py-1 mb-4">
          <BadgeCheck className="w-3.5 h-3.5" />
          {known ? known.kind : "Name screen"}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Is {name} trademarked?
        </h1>
        <p className="mt-3 text-slate-600">{copy.description}</p>

        <div className="mt-6">
          <VerdictCard
            data={check.data?.conflicts}
            loading={check.isFetching}
            error={check.error?.message}
            maxConflicts={5}
          />
        </div>

        {!check.isFetching && (
          <div className="mt-6 space-y-4">
            <ReportCTA
              name={name}
              classes={DEFAULT_CLASSES}
              verdict={check.data?.conflicts?.verdict}
            />
            <AttorneyLeadForm businessName={name} />
          </div>
        )}

        <div className="mt-8 space-y-4">
          {copy.faqs.map((f) => (
            <div key={f.q} className="rounded-2xl border bg-white p-5">
              <h2 className="font-semibold text-slate-900">{f.q}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{f.a}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-sm text-slate-600">
          Want the full eight-point checklist, including domains and
          sound-alikes?{" "}
          <Link
            to={`/namecheck?name=${encodeURIComponent(name)}`}
            className="text-navy-700 underline font-medium"
          >
            Open the full name check
          </Link>
          . Or{" "}
          <Link to="/search" className="text-navy-700 underline">
            search every USPTO record
          </Link>
          .
        </p>

        {related.length > 0 && (
          <div className="mt-8">
            <h2 className="font-semibold text-slate-900">Other names people check</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to={`/is/${r.slug}`}
                  className="text-sm px-3 py-1.5 rounded-full border border-navy-200 text-navy-800 hover:bg-navy-50"
                >
                  Is {r.name} trademarked?
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-xs text-slate-500">
          MarkCitadel is an information tool, not a law firm and not affiliated
          with the USPTO. Results are a preliminary screening and are not legal
          advice.
        </p>
      </div>
    </Layout>
  );
}
