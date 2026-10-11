import { Hono } from "hono";
import { buildNameCheckReport } from "../services/report";
import { getPaidReport } from "../services/plans";

/**
 * Paid report delivery: GET /api/reports/:sessionId.pdf
 * The Checkout Session id (cs_...) is only known to the buyer (success URL,
 * account page) and is checked against a paid purchase before generating.
 */
export const reports = new Hono();

reports.get("/:file", async (c) => {
  const sessionId = c.req.param("file").replace(/\.pdf$/, "");
  const purchase = await getPaidReport(sessionId).catch(() => null);
  if (!purchase) {
    return c.json(
      { error: "NOT_PAID", message: "No paid report found for this link." },
      404,
    );
  }
  try {
    const pdf = await buildNameCheckReport(purchase.name, {
      purchasedBy: purchase.email,
      classes: purchase.classes,
    });
    const safe = purchase.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    c.header("Content-Type", "application/pdf");
    c.header("Cache-Control", "private, no-store");
    c.header(
      "Content-Disposition",
      `${c.req.query("inline") ? "inline" : "attachment"}; filename="markcitadel-report-${safe}.pdf"`,
    );
    return c.body(new Uint8Array(pdf));
  } catch (e) {
    return c.json(
      {
        error: "UPSTREAM_ERROR",
        message:
          e instanceof Error ? e.message : "Report generation failed — try again shortly.",
      },
      502,
    );
  }
});
