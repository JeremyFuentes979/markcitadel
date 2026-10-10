import * as jose from "jose";
import { env } from "./env";

export interface SupabaseClaims {
  sub: string; // auth.users.id (uuid)
  email?: string;
  role?: string; // "authenticated"
  user_metadata?: { full_name?: string; name?: string; avatar_url?: string };
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

/**
 * Verify a Supabase access token.
 * - If SUPABASE_JWT_SECRET is set (legacy HS256 projects) we verify with it.
 * - Otherwise we verify against the project's JWKS (asymmetric signing keys,
 *   the default for new Supabase projects).
 */
export async function verifySupabaseToken(
  token: string,
): Promise<SupabaseClaims | null> {
  try {
    const issuer = env.supabaseUrl ? `${env.supabaseUrl}/auth/v1` : undefined;
    const opts: jose.JWTVerifyOptions = { audience: "authenticated", issuer };
    let payload: jose.JWTPayload;
    if (env.supabaseJwtSecret) {
      ({ payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(env.supabaseJwtSecret),
        { ...opts, algorithms: ["HS256"] },
      ));
    } else {
      if (!env.supabaseUrl) return null;
      jwks ??= jose.createRemoteJWKSet(
        new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`),
      );
      ({ payload } = await jose.jwtVerify(token, jwks, opts));
    }
    if (typeof payload.sub !== "string") return null;
    return payload as unknown as SupabaseClaims;
  } catch {
    return null;
  }
}

export function bearerToken(headers: Headers): string | null {
  const h = headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}
