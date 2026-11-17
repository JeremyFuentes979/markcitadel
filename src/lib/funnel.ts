/** Count a report-checkout start in the existing cookieless pageview log. */
export function recordReportCheckout(): void {
  if (import.meta.env.DEV) return;
  const body = JSON.stringify({
    path: "/event/report-checkout",
    ref: document.referrer,
  });
  navigator.sendBeacon?.(
    "/api/pv",
    new Blob([body], { type: "application/json" }),
  );
}
