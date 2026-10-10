/**
 * Live domain availability via RDAP (the official registry lookup protocol).
 * A 404 from the registry = the domain is unregistered. Fast, free, and
 * covers every TLD with an RDAP endpoint (com/net/org/io/ai and ~590 more).
 */

const RDAP_BY_TLD: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1/domain/",
  net: "https://rdap.verisign.com/net/v1/domain/",
  org: "https://rdap.publicinterestregistry.org/rdap/domain/",
  io: "https://rdap.identitydigital.services/rdap/domain/",
  ai: "https://rdap.identitydigital.services/rdap/domain/",
};

export interface DomainCheck {
  domain: string;
  status: "available" | "taken" | "unknown";
}

export const NAMECHECK_TLDS = ["com", "net", "org", "io", "ai"] as const;

/** Strip a user-entered name down to a plausible domain label. */
export function nameToLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 63);
}

async function checkOne(label: string, tld: string): Promise<DomainCheck> {
  const base = RDAP_BY_TLD[tld];
  const domain = `${label}.${tld}`;
  if (!base || !label) return { domain, status: "unknown" };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${base}${domain}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json, application/json" },
    });
    clearTimeout(t);
    if (res.status === 404) return { domain, status: "available" };
    if (res.ok) return { domain, status: "taken" };
    return { domain, status: "unknown" };
  } catch {
    return { domain, status: "unknown" };
  }
}

/** Check the same label across all supported TLDs, in parallel. */
export async function checkDomains(name: string): Promise<DomainCheck[]> {
  const label = nameToLabel(name);
  if (!label) return [];
  return Promise.all(NAMECHECK_TLDS.map((tld) => checkOne(label, tld)));
}
