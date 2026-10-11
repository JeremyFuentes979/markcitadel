import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";

export default function AlertsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth({
    redirectOnUnauthenticated: true,
  });
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const alerts = trpc.library.listAlerts.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const markRead = trpc.library.markAlertsRead.useMutation({
    onSuccess: () => {
      utils.library.unreadCount.invalidate();
      utils.library.listAlerts.invalidate();
    },
  });
  const checkMut = trpc.library.checkWatches.useMutation({
    onSuccess: (r) => {
      utils.library.listAlerts.invalidate();
      utils.library.listWatches.invalidate();
      utils.library.unreadCount.invalidate();
      toast.success(
        r.newAlerts > 0
          ? `${r.newAlerts} new alert${r.newAlerts > 1 ? "s" : ""} found`
          : "All watches checked — no changes since last time",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-check watches (rate-limited server-side) when the page opens
  const checkedRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && !checkedRef.current) {
      checkedRef.current = true;
      checkMut.mutate({ force: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (authLoading || !isAuthenticated) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto px-4 py-12 space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
          <div className="flex gap-2">
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
              Check now
            </button>
            <button
              onClick={() => markRead.mutate()}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border bg-white text-slate-600 hover:border-navy-300 transition-colors"
            >
              <CheckCheck className="w-4 h-4" /> Mark all read
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-2">
          Whenever you visit (or click “Check now”), we compare each watched
          search against live USPTO data. If the number of results changed —
          for example a new trademark application matching your brand name was
          filed — an alert appears here.
        </p>

        <div className="mt-6 space-y-3">
          {alerts.data?.length === 0 && (
            <div className="text-center text-slate-500 border border-dashed rounded-xl p-10">
              <Bell className="w-8 h-8 mx-auto mb-3 text-slate-300" />
              <p className="font-medium text-slate-700">No alerts yet</p>
              <p className="text-sm mt-1">
                Watch a search and we'll notify you here when its results
                change.
              </p>
            </div>
          )}
          {alerts.data?.map((a) => {
            const delta = a.newTotal - a.previousTotal;
            return (
              <div
                key={a.id}
                className={`border rounded-xl p-4 flex gap-4 ${
                  a.readAt ? "bg-white" : "bg-navy-50/60 border-navy-200"
                }`}
              >
                <span
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    delta > 0
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  <Bell className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-900">{a.message}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {new Date(a.createdAt).toLocaleString()}
                    {!a.readAt && (
                      <span className="ml-2 text-navy-600 font-medium">
                        New
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => navigate("/library")}
                  className="self-center text-xs font-medium text-navy-600 hover:text-navy-800 whitespace-nowrap"
                >
                  View watch
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
