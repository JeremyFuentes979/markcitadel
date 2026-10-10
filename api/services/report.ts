import PDFKit from "pdfkit";
import { phoneticVariants } from "./uspto";
import { checkTrademarkConflicts } from "./conflicts";
import { NICE_CLASSES } from "@contracts/conflicts";
import { checkDomains, nameToLabel } from "./domains";

/**
 * Name Clearance Report — a downloadable PDF assembling everything the
 * Name Check page shows, plus the top live conflicting marks. This is the
 * same class of product competitors sell as a "$49 trademark report",
 * generated from data we already pull.
 */

// pdfkit is imported normally and kept external to the bundle (netlify.toml
// external_node_modules) so its font metric files ship alongside it.
async function loadPdfkit(): Promise<typeof PDFKit> {
  return PDFKit;
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
  opts: { purchasedBy?: string | null; classes?: number[] } = {},
): Promise<Buffer> {
  const name = nameRaw.trim();
  const label = nameToLabel(name);

  const [conflicts, domains] = await Promise.all([
    checkTrademarkConflicts(name, opts.classes).catch(() => null),
    checkDomains(name).catch(() => []),
  ]);
  const known = !!conflicts && conflicts.verdict !== "unknown";
  const liveMarks = known ? conflicts!.counts.live : -1;
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

  // ── Bottom line (conflict verdict) ──
  sectionTitle("Bottom line");
  if (!known) {
    body(
      "Live trademark data could not be reached when this report was generated. Re-download it in a few minutes before relying on it.",
      AMBER,
    );
  } else {
    const c = conflicts!;
    const color = c.verdict === "high" ? RED : c.verdict === "possible" ? AMBER : GREEN;
    const label = c.verdict === "high" ? "HIGH RISK" : c.verdict === "possible" ? "POSSIBLE CONFLICT" : "LOOKS CLEAR";
    doc.font("Helvetica-Bold").fontSize(15).fillColor(color).text(label);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(SLATE).text(c.headline, { width: W });
    doc.moveDown(0.2);
    body(c.explanation);
    if (comTaken) body("Also: the exact .com domain is taken.", MUTED);
    if (c.degraded) body(c.degraded, AMBER);
  }
  doc.moveDown(0.6);

  // ── 1. USPTO trademark analysis ──
  sectionTitle("1. USPTO trademark analysis");
  if (!known) {
    body("Live data unavailable at generation time.", AMBER);
  } else {
    const c = conflicts!;
    body(
      `Classes analyzed: ${c.classes.map((n) => `${n} (${NICE_CLASSES[n] ?? ""})`).join(", ")}.`,
      MUTED,
    );
    body(
      `${c.counts.total.toLocaleString()} federal marks match "${name}" or its variants (exact, contained, sound-alike, near-spellings): ` +
        `${c.counts.live.toLocaleString()} live, ${c.counts.liveInYourClasses.toLocaleString()} live in your classes, ` +
        `${c.counts.exactLive.toLocaleString()} live with the identical wording. We scored the ${c.counts.analyzed} most relevant live marks.`,
    );
    doc.moveDown(0.3);
    if (c.topOwners.length) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(SLATE).text("Who already owns this word");
      for (const o of c.topOwners)
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(SLATE)
          .text(`•  ${o.owner}: ${o.liveMarks} live mark${o.liveMarks === 1 ? "" : "s"} (classes ${o.classes.join(", ") || "n/a"})`, { indent: 8, width: W });
      doc.moveDown(0.3);
    }
    if (c.topConflicts.length === 0) {
      body("No live marks scored as a meaningful conflict.", GREEN);
    } else {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(SLATE).text("Most relevant live marks (highest risk first)");
      doc.moveDown(0.2);
      for (const m of c.topConflicts) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor(m.score >= 75 ? RED : m.score >= 40 ? AMBER : SLATE)
          .text(`${m.wordmark}  ·  risk ${m.score}/100`, { indent: 8, width: W });
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor(SLATE)
          .text(
            `${m.owner ?? "Unknown owner"}  ·  ${m.registered ? `Reg. ${m.registrationNumber ?? ""}` : "Pending application"}  ·  SN ${m.serialNumber}  ·  Classes ${m.classes.join(", ") || "n/a"}`,
            { indent: 18, width: W - 10 },
          );
        doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Why flagged: ${m.reasons.join("; ")}.`, { indent: 18, width: W - 10 });
        doc.moveDown(0.25);
      }
    }
    doc.moveDown(0.2);
    body("Verify any mark at tsdr.uspto.gov using its serial number (SN).", MUTED);
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
