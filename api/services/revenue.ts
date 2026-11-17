/**
 * Name-check views → report checkout starts.
 * Returns a percent with one decimal, or null when there is nothing to divide.
 */
export function reportCheckoutRate(
  nameCheckViews: number,
  checkoutStarts: number,
): number | null {
  if (!Number.isFinite(nameCheckViews) || nameCheckViews <= 0) return null;
  if (!Number.isFinite(checkoutStarts) || checkoutStarts < 0) return null;
  return Math.round((checkoutStarts / nameCheckViews) * 1000) / 10;
}
