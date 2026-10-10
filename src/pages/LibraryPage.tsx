import { useNavigate } from "react-router";
import { BellRing, Bookmark, Eye, EyeOff, FileText, LoaderCircle, RefreshCw, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import type { SearchType } from "@contracts/types";

function searchUrl(type: SearchType, query: string, option: string) {
  const base = `/search?q=${encodeURIComponent(query)}&type=${type}`;
  return type === "trademarks" ? `${base}&status=${option}` : `${base}&sort=${option}`;
}

export default function LibraryPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth({
    redirectOnUnauthenticated: true,
  });
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const saved = trpc.library.listSaved.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const myReports = trpc.billing.myReports.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const watchList = trpc.library.listWatches.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const checkMut = trpc.library.checkWatches.useMutation({
    onSuccess: (r) => {
      utils.library.listWatches.invalidate();
      utils.library.listAlerts.invalidate();
      utils.library.unreadCount.invalidate();
      toast.success(
        r.newAlerts > 0
          ? `${r.newAlerts} new alert${r.newAlerts > 1 ? "s" : ""} — check the Alerts page`
          : "All watches checked — no changes",
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteSaved = trpc.library.deleteSaved.useMutation({
    onSuccess: () => utils.library.listSaved.invalidate(),
  });
  const removeWatch = trpc.library.removeWatch.useMutation({
    onSuccess: () => utils.library.listWatches.invalidate(),
  });
  const toggleWatch = trpc.library.toggleWatch.useMutation({
    onSuccess: () => utils.library.listWatches.invalidate(),
  });

  if (authLoading || !isAuthenticated) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-12 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            My searches &amp; watches
          </h1>
          <button
            onClick={() => checkMut.mutate({ force: true })}
            disabled={checkMut.isPending}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-navy-600 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
          >
            {checkMut.isPending ? (
              <LoaderCircle className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Check watches now
          </button>
        </div>

        {/* Purchased reports */}
        {(myReports.data?.length ?? 0) > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">
              Name Clearance Reports
            </h2>
            <div className="mt-3 divide-y rounded-xl border bg-white">
              {myReports.data!.map((r) => (
                <div key={r.id} className="p-3 flex items-center gap-3 text-sm">
                  <span className="flex-1 font-medium">{r.name}</span>
                  <span className="text-xs text-slate-500">
                    {r.paidAt ? new Date(r.paidAt).toLocaleDateString() : ""}
                  </span>
                  <a href={r.downloadUrl} className="text-navy-700 underline">
                    Download PDF
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Watches */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-navy-600" /> Watched searches
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            We track the result count for each watch and create an alert
            whenever it changes — e.g. when a new conflicting trademark gets
            filed.
          </p>
          <div className="mt-4 space-y-3">
            {watchList.data?.length === 0 && (
              <div className="text-sm text-slate-500 border border-dashed rounded-xl p-6 text-center">
                No watches yet — run a search and click “Watch for new results”.
              </div>
            )}
            {watchList.data?.map((w) => (
              <div
                key={w.id}
                className="bg-white border rounded-xl p-4 flex items-center gap-4"
              >
                <span
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    w.type === "trademarks"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-sky-100 text-sky-700"
                  }`}
                >
                  {w.type === "trademarks" ? (
                    <Tag className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </span>
                <button
                  onClick={() => navigate(searchUrl(w.type, w.query, w.option))}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-medium text-slate-900 truncate">
                    {w.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {w.lastTotal !== null
                      ? `${w.lastTotal.toLocaleString()} results as of last check`
                      : "Not checked yet"}
                    {w.lastCheckedAt &&
                      ` · ${new Date(w.lastCheckedAt).toLocaleString()}`}
                  </div>
                </button>
                <button
                  onClick={() =>
                    toggleWatch.mutate({ id: Number(w.id), active: !w.active })
                  }
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  title={w.active ? "Pause watch" : "Resume watch"}
                >
                  {w.active ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => removeWatch.mutate({ id: Number(w.id) })}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="Remove watch"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Saved searches */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-navy-600" /> Saved searches
          </h2>
          <div className="mt-4 space-y-3">
            {saved.data?.length === 0 && (
              <div className="text-sm text-slate-500 border border-dashed rounded-xl p-6 text-center">
                Nothing saved yet — run a search and click “Save search”.
              </div>
            )}
            {saved.data?.map((s) => (
              <div
                key={s.id}
                className="bg-white border rounded-xl p-4 flex items-center gap-4"
              >
                <span
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    s.type === "trademarks"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-sky-100 text-sky-700"
                  }`}
                >
                  {s.type === "trademarks" ? (
                    <Tag className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </span>
                <button
                  onClick={() => navigate(searchUrl(s.type, s.query, s.option))}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-medium text-slate-900 truncate">
                    {s.label}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 capitalize">
                    {s.type}
                    {s.type === "trademarks" && s.option !== "all"
                      ? ` · ${s.option} only`
                      : ""}
                    {s.type === "patents" ? ` · sorted by ${s.option}` : ""}
                  </div>
                </button>
                <button
                  onClick={() => deleteSaved.mutate({ id: Number(s.id) })}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  title="Delete saved search"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
