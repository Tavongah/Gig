/**
 * Paynow SHA-512 hash helpers — follow official docs exactly.
 * Never log Integration Key or the concatenated hash source string.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Format cents as Paynow amount (two decimal places). */
export function formatPaynowAmount(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new Error("Invalid amount for Paynow");
  }
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * Generate Paynow hash:
 * concatenate field VALUES in order (excluding hash), append Integration Key,
 * UTF-8 SHA-512, uppercase hex.
 */
export function generatePaynowHash(
  orderedValues: string[],
  integrationKey: string
): string {
  const payload = `${orderedValues.join("")}${integrationKey}`;
  return createHash("sha512").update(payload, "utf8").digest("hex").toUpperCase();
}

/**
 * Hash from an ordered map (insertion order = hash order). Skips `hash` key.
 */
export function generatePaynowHashFromFields(
  fields: Record<string, string>,
  integrationKey: string,
  order: string[]
): string {
  const values = order
    .filter((k) => k.toLowerCase() !== "hash")
    .map((k) => fields[k] ?? "");
  return generatePaynowHash(values, integrationKey);
}

export function verifyPaynowHash(
  orderedValues: string[],
  integrationKey: string,
  suppliedHash: string
): boolean {
  if (!suppliedHash || !integrationKey) return false;
  const expected = generatePaynowHash(orderedValues, integrationKey);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(suppliedHash).trim().toUpperCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify hash for a decoded field map using explicit key order (excluding hash).
 */
export function verifyPaynowHashFromFields(
  fields: Record<string, string>,
  integrationKey: string,
  order: string[]
): boolean {
  const supplied = fields.hash ?? fields.Hash ?? "";
  const values = order
    .filter((k) => k.toLowerCase() !== "hash")
    .map((k) => {
      const found = Object.entries(fields).find(([key]) => key.toLowerCase() === k.toLowerCase());
      return found?.[1] ?? "";
    });
  return verifyPaynowHash(values, integrationKey, supplied);
}

/**
 * Parse application/x-www-form-urlencoded (or query-string style) Paynow body.
 * Values are URL-decoded. Preserves first-seen key order (lowercased keys).
 */
export function parsePaynowUrlEncoded(raw: string | Buffer): {
  fields: Record<string, string>;
  order: string[];
} {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  const fields: Record<string, string> = {};
  const order: string[] = [];
  const pairs = text.replace(/^\?/, "").split("&").filter(Boolean);
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
    const rawVal = eq >= 0 ? pair.slice(eq + 1) : "";
    const key = decodePaynowComponent(rawKey);
    const value = decodePaynowComponent(rawVal);
    const lower = key.toLowerCase();
    if (!(lower in fields)) order.push(lower);
    fields[lower] = value;
  }
  return { fields, order };
}

function decodePaynowComponent(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, "%20").replace(/%(?![\da-f]{2})/gi, "%25"));
}

/** Encode body as application/x-www-form-urlencoded (keys in given order). */
export function encodePaynowForm(fields: Record<string, string>, order: string[]): string {
  return order
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k] ?? "")}`)
    .join("&");
}

/**
 * Official docs outbound example vector
 * (integration key 3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977).
 */
export const PAYNOW_HASH_DOC_VECTOR = {
  fields: {
    id: "1201",
    reference: "TEST REF",
    amount: "99.99",
    additionalinfo: "A test ticket transaction",
    returnurl: "http://www.google.com/search?q=returnurl",
    resulturl: "http://www.google.com/search?q=resulturl",
    status: "Message"
  },
  order: [
    "id",
    "reference",
    "amount",
    "additionalinfo",
    "returnurl",
    "resulturl",
    "status"
  ],
  integrationKey: "3e9fed89-60e1-4ce5-ab6e-6b1eb2d4f977",
  expectedHash:
    "2A033FC38798D913D42ECB786B9B19645ADEDBDE788862032F1BD82CF3B92DEF84F316385D5B40DBB35F1A4FD7D5BFE73835174136463CDD48C9366B0749C689"
} as const;

/** Mobile initiate field order used by DUTS (hash over these values before encoding). */
export const PAYNOW_MOBILE_INIT_ORDER = [
  "id",
  "reference",
  "amount",
  "additionalinfo",
  "returnurl",
  "resulturl",
  "authemail",
  "phone",
  "method",
  "status"
] as const;

/** Common status-update / poll field order from Paynow docs examples. */
export const PAYNOW_STATUS_ORDER = [
  "reference",
  "paynowreference",
  "amount",
  "status",
  "pollurl"
] as const;
