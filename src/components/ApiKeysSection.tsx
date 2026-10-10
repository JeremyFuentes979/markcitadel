import { useState } from "react";
import { Link } from "react-router";
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBlock } from "@/components/CodeBlock";

export function ApiKeysSection({ origin }: { origin: string }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();
  const keys = trpc.apiKeys.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const myPlan = trpc.billing.myPlan.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<{
    name: string;
    rawKey: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = trpc.apiKeys.create.useMutation({
    onSuccess: (r) => {
      utils.apiKeys.list.invalidate();
      setJustCreated({ name: r.name, rawKey: r.rawKey });
      setNewName("");
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeMut = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
      toast.success("Key revoked");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyKey = async (k: string) => {
    try {
      await navigator.clipboard.writeText(k);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (authLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="border border-dashed rounded-2xl p-8 text-center bg-slate-50">
        <KeyRound className="w-8 h-8 mx-auto text-slate-400 mb-3" />
        <p className="font-medium text-slate-900">
          Sign in to create a free API key
        </p>
        <p className="text-sm text-slate-500 mt-1 mb-4">
          Free tier: 30 requests/minute · 1,000 requests/month. No credit card.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-sm font-medium bg-navy-600 text-white rounded-lg px-5 py-2.5 hover:bg-navy-700 transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="border rounded-2xl bg-white overflow-hidden">
      <div className="px-5 py-4 border-b bg-slate-50 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">Your API keys</span>
            {myPlan.data && (
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  myPlan.data.plan === "pro"
                    ? "bg-navy-800 text-brass-300"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {myPlan.data.name} plan
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {myPlan.data
              ? `${myPlan.data.requestsPerMinute} requests/minute · ${myPlan.data.requestsPerMonth.toLocaleString()} requests/month per key`
              : "Loading plan…"}
            {myPlan.data?.plan === "free" && (
              <>
                {" "}
                ·{" "}
                <Link to="/pricing" className="text-navy-700 underline">
                  Upgrade to Pro
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              newName.trim() &&
              createMut.mutate({ name: newName.trim() })
            }
            placeholder="Key name (e.g. my app)"
            className="border rounded-lg px-3 py-2 text-sm w-44 outline-none focus:border-navy-400"
          />
          <button
            onClick={() =>
              newName.trim() && createMut.mutate({ name: newName.trim() })
            }
            disabled={!newName.trim() || createMut.isPending}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-navy-600 text-white hover:bg-navy-700 disabled:opacity-40 transition-colors"
          >
            {createMut.isPending ? (
              <LoaderCircle className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Create key
          </button>
        </div>
      </div>

      {justCreated && (
        <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-200">
          <div className="text-sm font-medium text-emerald-900">
            Key “{justCreated.name}” created — copy it now, it won't be shown
            again
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-emerald-300 rounded-lg px-3 py-2 font-mono break-all">
              {justCreated.rawKey}
            </code>
            <button
              onClick={() => copyKey(justCreated.rawKey)}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setJustCreated(null)}
            className="mt-2 text-xs text-emerald-700 hover:underline"
          >
            I've saved it — dismiss
          </button>
        </div>
      )}

      <div className="divide-y">
        {keys.data?.length === 0 && (
          <div className="px-5 py-8 text-sm text-slate-500 text-center">
            No keys yet — name one above and click “Create key”.
          </div>
        )}
        {keys.data?.map((k) => (
          <div key={k.id} className="px-5 py-4 flex items-center gap-4">
            <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900 text-sm">
                  {k.name}
                </span>
                <code className="text-xs text-slate-400 font-mono">
                  {k.prefix}…
                </code>
                {!k.active && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    Revoked
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {k.monthlyUsed.toLocaleString()} /{" "}
                {k.monthlyLimit.toLocaleString()} requests this month
                {k.lastUsedAt &&
                  ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`}
              </div>
              <div className="mt-1.5 h-1.5 w-48 max-w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    k.monthlyUsed / k.monthlyLimit > 0.85
                      ? "bg-amber-500"
                      : "bg-navy-500"
                  }`}
                  style={{
                    width: `${Math.min(100, (k.monthlyUsed / k.monthlyLimit) * 100)}%`,
                  }}
                />
              </div>
            </div>
            {k.active && (
              <button
                onClick={() => {
                  if (confirm(`Revoke key “${k.name}”? This can't be undone.`))
                    revokeMut.mutate({ id: k.id });
                }}
                className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                title="Revoke key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {(keys.data?.length ?? 0) > 0 && (
        <div className="px-5 py-4 border-t bg-slate-50">
          <CodeBlock
            language="curl — replace with your key"
            code={`curl -H "Authorization: Bearer pmk_YOUR_KEY" \\
  "${origin}/api/v1/trademarks/search?q=acme&status=live"`}
          />
        </div>
      )}
    </div>
  );
}
