import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getAccessToken } from "@/lib/supabase";

/**
 * OAuth consent screen for AI connectors (ChatGPT, Claude, …).
 * The client lands here from /.well-known/oauth-authorization-server →
 * authorization_endpoint. Approving mints a MarkCitadel API key for that
 * connector (visible and revocable on the Developers page).
 */
const PARAMS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
  "scope",
] as const;

export default function OAuthAuthorizePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = Object.fromEntries(
    PARAMS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        const here = window.location.pathname + window.location.search;
        navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
        return;
      }
      const r = await fetch(`/api/oauth/client?${new URLSearchParams(query)}`);
      const j = await r.json().catch(() => ({ ok: false, error: "Unexpected response" }));
      if (j.ok) setInfo(j);
      else setError(j.error ?? "Invalid request");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const token = await getAccessToken();
    const r = await fetch("/api/oauth/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...query, approve }),
    });
    const j = await r.json().catch(() => ({ ok: false, error: "Unexpected response" }));
    if (j.ok && j.redirect) {
      window.location.assign(j.redirect);
      return;
    }
    setError(j.error ?? "Could not complete sign-in");
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Connect to MarkCitadel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-600">
          {error ? (
            <p className="text-red-600 text-center">{error}</p>
          ) : !info ? (
            <p className="text-center">Checking the request…</p>
          ) : (
            <>
              <p>
                <strong>{info.clientName}</strong> wants to search USPTO trademarks and
                patents with your MarkCitadel account.
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>It gets an API key named “AI connector: {info.clientName}”.</li>
                <li>Searches count toward your plan’s API limits.</li>
                <li>It can’t see your saved searches, billing or email.</li>
                <li>Revoke it anytime on the Developers page.</li>
              </ul>
              <p className="text-xs text-slate-400">
                You’ll be sent back to <span className="font-mono">{info.redirectHost}</span>.
              </p>
              <div className="flex gap-3">
                <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                  Allow
                </Button>
                <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
