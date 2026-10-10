import { Link } from "react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Eye,
  Globe,
  LayoutDashboard,
  Link2,
  Minus,
  Users,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

/**
 * Owner-only site analytics dashboard. Hidden from navigation; reachable at
 * /stats. Non-owners are bounced to a friendly message (the API itself is
 * FORBIDDEN-guarded, so this page leaks nothing).
 */
export default function StatsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isOwner = trpc.billing.isOwner.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const stats = trpc.analytics.stats.useQuery(undefined, {
    enabled: !!isOwner.data,
    retry: false,
    refetchInterval: 60_000,
  });

  const byDay = stats.data?.byDay ?? [];
  const maxViews = Math.max(1, ...byDay.map((d) => d.views));

  const trend = (() => {
    if (byDay.length < 14) return null;
    const half = Math.floor(byDay.length / 2);
    const prev = byDay.slice(0, half).reduce((s, d) => s + d.views, 0);
    const cur = byDay.slice(-half).reduce((s, d) => s + d.views, 0);
    if (prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
  })();

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex items-center gap-2 text-navy-700 mb-1">
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            Owner dashboard
          </span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Site analytics
        </h1>
        <p className="text-slate-600 mb-8 max-w-2xl">
          First-party, privacy-friendly stats for markcitadel — last{" "}
          {stats.data?.days ?? 30} days. Counts real page loads of the site
          itself (bots filtered out). Redirect traffic through markcitadel.com
          is measured separately in Cloudflare.
        </p>

        {authLoading || isOwner.isLoading ? (
          <p className="text-slate-500">Checking access…</p>
        ) : !isAuthenticated ? (
          <div className="rounded-xl border bg-white p-8 text-center">
            <p className="text-slate-600 mb-4">
              Sign in to view site analytics.
            </p>
            <Link
              to="/login"
              className="text-navy-700 font-medium underline hover:text-navy-900"
            >
              Sign in
            </Link>
          </div>
        ) : !isOwner.data ? (
          <div className="rounded-xl border bg-white p-8 text-center">
            <p className="text-slate-600">
              This dashboard is only visible to the site owner.
            </p>
          </div>
        ) : stats.isLoading ? (
          <p className="text-slate-500">Loading stats…</p>
        ) : stats.error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
            Couldn't load stats: {stats.error.message}
          </div>
        ) : stats.data ? (
          <div className="space-y-8">
            {/* Headline numbers */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={<Eye className="w-4 h-4" />}
                label="Page views"
                value={stats.data.totals.views}
              />
              <StatCard
                icon={<Users className="w-4 h-4" />}
                label="Unique visitors"
                value={stats.data.totals.uniqueVisitors}
              />
              <StatCard
                icon={
                  trend == null ? (
                    <Minus className="w-4 h-4" />
                  ) : trend >= 0 ? (
                    <ArrowUpRight className="w-4 h-4" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4" />
                  )
                }
                label="Trend (2nd half vs 1st)"
                value={trend == null ? "—" : `${trend >= 0 ? "+" : ""}${trend}%`}
              />
              <StatCard
                icon={<Activity className="w-4 h-4" />}
                label="Bot hits (excluded)"
                value={stats.data.totals.botViews}
              />
            </div>

            {/* Daily chart */}
            <div className="rounded-xl border bg-white p-6">
              <h2 className="font-semibold text-slate-900 mb-4">
                Views per day
              </h2>
              {byDay.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  No traffic recorded yet — data appears here once the updated
                  site is live and people visit.
                </p>
              ) : (
                <div className="flex items-end gap-[3px] h-40">
                  {byDay.map((d) => (
                    <div
                      key={d.day}
                      className="group relative flex-1 min-w-[4px]"
                    >
                      <div
                        className="w-full rounded-t bg-navy-700/80 group-hover:bg-navy-800 transition-colors"
                        style={{
                          height: `${Math.max(2, (d.views / maxViews) * 100)}%`,
                        }}
                      />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap rounded-md bg-navy-950 text-white text-xs px-2 py-1 z-10">
                        {d.day}: {d.views} views · {d.visitors} visitors
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {byDay.length > 0 && (
                <div className="flex justify-between text-xs text-slate-400 mt-2">
                  <span>{byDay[0].day}</span>
                  <span>{byDay[byDay.length - 1].day}</span>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Top pages */}
              <div className="rounded-xl border bg-white p-6">
                <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-navy-600" /> Top pages
                </h2>
                {stats.data.topPages.length === 0 ? (
                  <p className="text-slate-500 text-sm">No data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-400 border-b">
                        <th className="pb-2 font-medium">Page</th>
                        <th className="pb-2 font-medium text-right">Views</th>
                        <th className="pb-2 font-medium text-right">
                          Visitors
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.data.topPages.map((p) => (
                        <tr key={p.path} className="border-b last:border-0">
                          <td className="py-2 text-navy-700 font-mono text-xs">
                            {p.path}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {p.views}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {p.visitors}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Referrers */}
              <div className="rounded-xl border bg-white p-6">
                <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-navy-600" /> Where visitors
                  come from
                </h2>
                {stats.data.referrers.length === 0 ? (
                  <p className="text-slate-500 text-sm">No data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-400 border-b">
                        <th className="pb-2 font-medium">Source</th>
                        <th className="pb-2 font-medium text-right">Views</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.data.referrers.map((r) => (
                        <tr key={r.host} className="border-b last:border-0">
                          <td className="py-2 text-slate-700">
                            {r.host === "(direct)" ? (
                              <span className="text-slate-400">
                                Direct / typed in
                              </span>
                            ) : (
                              r.host
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {r.views}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Tracking is cookieless: visitors are counted by a one-way daily
              hash of IP + browser, so unique counts reset each day. No personal
              data is stored and nothing is shared with third parties.
            </p>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center gap-1.5 text-navy-600 mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-slate-900 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
