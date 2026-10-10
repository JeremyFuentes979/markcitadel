# MarkCitadel — Project Brief & Handover Notes

**What it is:** A website + developer API ("connector") for searching U.S. patents and trademarks, built on live USPTO data. Designed to be consumed by people, AI agents (MCP), domain-name tools, and LLC/startup sites. Monetized with API keys + a paid Pro tier via Stripe.

**Live name/domain:** MarkCitadel · markcitadel.com (registered on Cloudflare) · platform URL: markcitadel.ok.kimi.link (after publishing + renaming)

---

## Current state (as of 2026-08-31)

Everything below is **built, tested, and version-saved**. Latest version: `b01e3e4`.

- **Search website** — trademarks (text + visual image search with live/dead filters and Nice-class filter), patents (official USPTO Open Data Portal API + fallback to Patent Public Search; BRS field codes like `quantum.ti.` supported)
- **Accounts** — "Sign in with Kimi" OAuth; saved searches; watches; in-app alerts when watched result counts change
- **Connector API** (`/api/v1/...`) — REST endpoints + `/openapi.json`; CORS open; requires Bearer API keys (`pmk_…`) for external callers; browser-internal use is keyless
- **MCP server** (`/api/mcp`) — native connector for Claude/ChatGPT-style agents; tools/list keyless, tools/call requires a key
- **Billing** — Free (30 req/min, 1,000 req/mo, 5 keys) and Pro $29/mo (120 req/min, 25,000 req/mo, 25 keys). Stripe **Payment Link** checkout + one-time upgrade codes (`mku_…`) the user pastes back after paying; owner-only "Billing activity" panel on /pricing to reconcile against Stripe payment emails and downgrade non-payers
- **Legal** — Terms of Service at /terms (USPTO attribution, acceptable use, billing terms); registration help guide at /register-help (trademark + patent, 2026 fees)

## Remaining launch checklist (owner steps)

1. **Publish** via the 「发布 / Publish」button on the version card
2. **Rename** subdomain to `markcitadel.ok.kimi.link` (Share dialog)
3. **Test-buy Pro once** with own card → confirm limits upgrade → cancel from Stripe receipt email
4. **Cloudflare redirect**: A record `@` → 192.0.2.1 (proxied) + Redirect Rule → `https://markcitadel.ok.kimi.link` (301, preserve path/query)

## Secrets & accounts (where things live)

- **USPTO Open Data Portal key** — in project `.env` as `USPTO_ODP_API_KEY`; manage at data.uspto.gov/apikey (needs USPTO.gov account + ID.me + MFA + the 4 profile fields)
- **Stripe Payment Link** — in `.env` as `STRIPE_PAYMENT_LINK`; payments land in the owner's Stripe account; refunds/cancellations handled in Stripe dashboard
- **Database** — platform-managed MySQL (users, saved searches, watches, alerts, API keys, usage, upgrade tokens). Not portable with code export.
- **Owner-only features** (billing panel) key off `OWNER_UNION_ID` in `.env`.

## Architecture notes (for future work)

- React 19 + Vite + Tailwind frontend; Hono + tRPC + Drizzle ORM + MySQL backend
- Search data layer: `api/services/uspto.ts` (ODP official-first with ppubs fallback; tiered relevance query builder; TTL cache 5 min)
- Plans/limits: `api/services/plans.ts` (PLANS dict) + `api/services/apikeys.ts` (hash-only key storage, per-minute limiter, monthly rollup)
- Key behaviors: new keys inherit user's plan; upgrading flips existing keys; monthly quota resets calendar-month; patent paging capped at 1,000 results
- Trademark/image search uses USPTO's public systems (no official real-time TM API exists); long-term hardening option: self-host USPTO bulk trademark data

## Roadmap (deliberately deferred)

- Referral/affiliate block on /register-help (attorney/filing-service referrals, ~$50–150 each; add disclosure to Terms when enabling)
- Trademark monitoring plan ($10–15/mo) built on existing Watch/Alerts
- Self-hosted migration (Railway/Vercel + Neon) when justified — enables Stripe webhooks for automatic Pro activation; auth must be swapped from Kimi OAuth to own credentials; DB must be migrated
- Do NOT become a filing service (USPTO US-counsel rule; attorney required)

## If starting a new chat

Paste this whole file, plus say "the project is in my output/app with version history." The agent can read the code directly from there.
