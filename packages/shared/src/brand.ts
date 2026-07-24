/**
 * User-facing product brand. Keep technical package IDs (@gigflow/*) separate.
 */
export const APP_BRAND = "DUTS";

/** Rewrite legacy product-name wording in stored or generated user-visible text. */
export function brandSanitizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/\bGig\s*Flow\b/gi, APP_BRAND)
    .replace(/\bGIGFLOW\b/g, APP_BRAND)
    .replace(/\bGigFlow\b/g, APP_BRAND)
    .replace(/\bGigflow\b/g, APP_BRAND);
}
