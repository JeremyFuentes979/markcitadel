import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

/** Sign in with Supabase Auth: Google OAuth or an email magic link. */
export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(next)}`;

  // Already signed in (or just returned from Google / the magic link)
  useEffect(() => {
    const go = (signedIn: boolean) => signedIn && navigate(next, { replace: true });
    supabase.auth.getSession().then(({ data }) => go(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => go(!!session));
    return () => data.subscription.unsubscribe();
  }, [navigate, next]);

  const google = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      toast.error(error.message);
      setBusy(false);
    }
  };

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Sign in to MarkCitadel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full" size="lg" variant="outline" disabled={busy} onClick={google}>
            Continue with Google
          </Button>
          <div className="text-center text-xs text-slate-400">or</div>
          {sent ? (
            <p className="text-sm text-slate-600 text-center">
              Check <strong>{email}</strong> for a sign-in link.
            </p>
          ) : (
            <form onSubmit={magicLink} className="space-y-2">
              <Input
                type="email"
                required
                placeholder="you@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                Email me a sign-in link
              </Button>
            </form>
          )}
          <p className="text-[11px] text-center text-slate-500">
            By continuing you agree to the <Link to="/terms" className="underline">Terms</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
