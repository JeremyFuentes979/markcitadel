import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { bearerToken, verifySupabaseToken } from "./lib/supabaseAuth";
import { upsertUserFromClaims } from "./queries/users";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

/** Resolve the caller from a Supabase access token (Authorization: Bearer). */
export async function userFromRequest(headers: Headers): Promise<User | undefined> {
  const token = bearerToken(headers);
  if (!token) return undefined;
  const claims = await verifySupabaseToken(token);
  if (!claims) return undefined;
  return upsertUserFromClaims(claims);
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await userFromRequest(opts.req.headers);
  } catch (e) {
    console.warn("[auth] could not resolve user:", e instanceof Error ? e.message : e);
  }
  return ctx;
}
