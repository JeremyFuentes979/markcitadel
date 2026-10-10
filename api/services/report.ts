import {
  getLiveTrademarkCount,
  phoneticVariants,
  searchTrademarks,
} from "./uspto";
import { checkDomains, nameToLabel } from "./domains";

/**
 * Name Clearance Report — a downloadable PDF assembling everything the
 * Name Check page shows, plus the top live conflicting marks. This is the
 * same class of product competitors sell as a "$49 trademark report",
 * generated from data we already pull.
 */

// pdfkit is loaded at runtime (not bundled): its CJS internals collide with
// the ESM server bundle's createRequire banner. node_modules is present at
// runtime, so a plain require resolves it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PDFDocumentClass: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPdfkit(): Promise<any> {
  if (!PDFDocumentClass) {
    const { createRequire } = await import("node:module");
    PDFDocumentClass = createRequire(import.meta.url)("pdfkit");
  }
  return PDFDocumentClass;
}

const NAVY = "#2b3d60";
const BRASS = "#b08a1e";
const SLATE = "#334155";
const MUTED = "#64748b";
const RED = "#b91c1c";
const GREEN = "#15803d";
const AMBER = "#b45309";

function statusColor(ok: boolean | null): string {
  if (ok === null) return AMBER;
  return ok ? GREEN : RED;
}

export const REPORT_DISCLAIMER =
  "NOT LEGAL ADVICE. MarkCitadel is an information service, not a law firm, and is not affiliated with or endorsed by the USPTO. " +
  "This report is generated automatically from public USPTO trademark records and public domain-registration (RDAP) data as they were available at the time of generation; " +
  "those sources can be incomplete, delayed, or temporarily unavailable. It is a preliminary screening only: it does not search state registrations, common-law (unregistered) use, foreign registrations, or design marks comprehensively, " +
  "and it does not assess likelihood of confusion, registrability, or infringement risk for your specific goods or services. " +
  "No attorney-client relationship is created by purchasing or reading this report. Before adopting, filing, or enforcing a mark, consult a licensed trademark attorney.";

export async function buildNameCheckReport(
  nameRaw: string,
  opts: { purchasedBy?: string | null } = {},
): Promise<Buffer> {
  const name = nameRaw.trim();
  const label = nameToLabel(name);

  const [liveMarks, domains, liveHits] = await Promise.all([
    getLiveTrademarkCount(name).catch(() => -1),
    checkDomains(name).catch(() => []),
    searchTrademarks({ query: name, status: "live", perPage: 10 })
      .then((r) => r.results)
      .catch(() => []),
  ]);
  const soundAlikes = phoneticVariants(name);
  const comTaken = domains.some(
    (d) => d.domain.endsWith(".com") && d.status === "taken",
  );

  const PDFDocument = await loadPdfkit();
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title: `MarkCitadel Name Clearance Report — ${name}`,
      Author: "MarkCitadel",
      Subject: "Trademark & brand-name clearance check",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const hr = () => {
    doc
      .moveDown(0.4)
      .strokeColor("#e2e8f0")
      .lineWidth(1)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + W, doc.y)
      .stroke()
      .moveDown(0.4);
  };

  const sectionTitle = (t: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(t);
    doc.moveDown(0.2);
  };

  const body = (t: string, color = SLATE) => {
    doc.font("Helvetica").fontSize(10).fillColor(color).text(t, { width: W });
  };

  // ── Header ──
  doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text("MarkCitadel");
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(BRASS)
    .text("I P   S E A R C H   C O N N E C T O R", { characterSpacing: 1.5 });
  doc.moveDown(1.2);
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor(SLATE)
    .text("Name Clearance Report");
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(MUTED)
    .text(
      `Name checked: "${name}"  ·  Generated ${new Date().toUTCString().slice(0, 16)} UTC  ·  markcitadel.com`,
    );
  if (opts.purchasedBy) {
    doc.fontSize(9).fillColor(MUTED).text(`Prepared for: ${opts.purchasedBy}`);
  }
  doc.moveDown(0.4);
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(RED)
    .text(
      "Not legal advice — a preliminary, automated screening. See the full disclaimer at the end of this report.",
      { width: W },
    );
  hr();

  // ── Bottom line ──
  sectionTitle("Bottom line");
  const clearish = liveMarks === 0 && !comTaken;
  if (liveMarks === -1) {
    body(
      "Live trademark data could not be reached when this report was generated — re-run the check before relying on it.",
      AMBER,
    );
  } else if (clearish) {
    body(
      `No live USPTO trademarks match "${name}" and the .com domain is available. That clears the two biggest hurdles — but complete the manual checks in this report (state registrations, web presence, international) before committing.`,
      GREEN,
    );
  } else {
    const bits: string[] = [];
    if (liveMarks > 0)
      bits.push(
        `${liveMarks} live USPTO trademark${liveMarks === 1 ? "" : "s"} match "${name}"`,
      );
    if (comTaken) bits.push(`the .com domain is taken`);
    body(
      `Caution: ${bits.join(" and ")}. That doesn't automatically block you — what matters is whether those marks cover your industry — but review them before spending money on branding or filing.`,
      RED,
    );
  }
  doc.moveDown(0.6);

  // ── 1. USPTO trademarks ──
  sectionTitle("1. USPTO trademark search");
  if (liveMarks === -1) {
    body("Live data unavailable at generation time.", AMBER);
  } else if (liveMarks === 0) {
    body(`No live federal trademarks match "${name}". Clear.`, GREEN);
  } else {
    body(
      `${liveMarks} live mark${liveMarks === 1 ? "" : "s"} found. Top matches:`,
      statusColor(false),
    );
    doc.moveDown(0.3);
    for (const m of liveHits.slice(0, 10)) {
      const line = [
        m.wordmark || "(design mark)",
        m.registered ? "Registered" : "Pending",
        m.owner ? `— ${m.owner}` : "",
        m.serialNumber ? `(SN ${m.serialNumber})` : "",
      ]
        .filter(Boolean)
        .join("  ");
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor(SLATE)
        .text(`•  ${line}`, { indent: 8, width: W });
    }
    doc.moveDown(0.2);
    body(
      `Review the full records at tsdr.uspto.gov or run the search at markcitadel.com/search.`,
      MUTED,
    );
  }
  doc.moveDown(0.6);

  // ── 2. Domains ──
  sectionTitle("2. Exact-match domains");
  if (domains.length === 0) {
    body("Domain availability could not be checked at generation time.", AMBER);
  } else {
    for (const d of domains) {
      const label2 =
        d.status === "available"
          ? "Available"
          : d.status === "taken"
            ? "Taken"
            : "Unknown";
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(SLATE)
        .text(`${d.domain}`, { continued: true, indent: 8 })
        .fillColor(
          d.status === "available"
            ? GREEN
            : d.status === "taken"
              ? RED
              : AMBER,
        )
        .text(`   ${label2}`);
    }
    doc.moveDown(0.2);
    if (comTaken) {
      body(
        "The .com is taken. Alternatives (.io, .ai) work for tech, but a taken .com with an active site in your industry is a real conflict risk.",
        MUTED,
      );
    } else {
      body(
        "Register the .com before announcing the name publicly — domain squatters watch new filings.",
        MUTED,
      );
    }
  }
  doc.moveDown(0.6);

  // ── 3. Sound-alikes ──
  sectionTitle("3. Similar-sounding brands");
  if (soundAlikes.length > 0) {
    body(
      `Registrations are refused for marks that sound alike, not just look alike. Phonetic variants to check: ${soundAlikes.join(", ")}.`,
    );
  } else {
    body("No common phonetic variants generated for this name.");
  }
  doc.moveDown(0.6);

  // ── 4. Manual checks ──
  sectionTitle("4. Remaining checks (do these yourself)");
  const manual: [string, string][] = [
    [
      "State business registrations",
      "Your state can register an LLC name that's trademarked by someone else (and vice versa). Search opencorporates.com and your Secretary of State's business search.",
    ],
    [
      "Social handles",
      `Check x.com/${label}, instagram.com/${label}, linkedin.com/company/${label}, tiktok.com/@${label}, youtube.com/@${label}.`,
    ],
    [
      "Existing companies",
      "An unregistered company trading under the name can still hold common-law rights where it operates. Search OpenCorporates, Crunchbase, and LinkedIn.",
    ],
    [
      "Google the name",
      `Search "${name}" exactly, plus "${name} company" and "${name} brand" — looking for news, app listings, products, or anything you don't want to be confused with.`,
    ],
    [
      "International conflicts",
      "USPTO only covers the US. If you might sell abroad: WIPO Global Brand Database (branddb.wipo.int), TMview (EU/UK), UK IPO.",
    ],
  ];
  for (const [title, desc] of manual) {
    if (doc.y > doc.page.height - 110) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(SLATE).text(title);
    body(desc, MUTED);
    doc.moveDown(0.3);
  }

  // ── 5. Next step ──
  sectionTitle("5. Next step: professional clearance");
  body(
    "If you plan to invest in this name (signage, vehicle wraps, a website, or a federal filing), have a licensed trademark attorney run a full clearance search and opinion. You can request an introduction at markcitadel.com/namecheck.",
  );

  // ── Footer / disclaimer ──
  doc.moveDown(0.8);
  hr();
  if (doc.y > doc.page.height - 150) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE).text("Disclaimer");
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(REPORT_DISCLAIMER, { width: W });

  doc.end();
  return done;
}
