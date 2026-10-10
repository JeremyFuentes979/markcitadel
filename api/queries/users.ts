import * as schema from "@db/schema";
import { getDb } from "./connection";
import { env } from "../lib/env";
import type { SupabaseClaims } from "../lib/supabaseAuth";

/** Upsert the local users row for a verified Supabase user. */
export async function upsertUserFromClaims(c: SupabaseClaims) {
  const email = c.email?.toLowerCase() ?? null;
  const name = c.user_metadata?.full_name ?? c.user_metadata?.name ?? null;
  const avatar = c.user_metadata?.avatar_url ?? null;
  const isOwner = !!env.ownerEmail && email === env.ownerEmail;
  const now = new Date();
  const [row] = await getDb()
    .insert(schema.users)
    .values({
      authId: c.sub,
      email,
      name,
      avatar,
      role: isOwner ? "admin" : "user",
      lastSignInAt: now,
    })
    .onConflictDoUpdate({
      target: schema.users.authId,
      set: {
        email,
        ...(name ? { name } : {}),
        ...(avatar ? { avatar } : {}),
        role: isOwner ? "admin" : "user",
        lastSignInAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export function isOwner(user: { email: string | null } | undefined): boolean {
  return !!env.ownerEmail && !!user?.email && user.email.toLowerCase() === env.ownerEmail;
}
