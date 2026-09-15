/**
 * Zimbabwe EcoCash payer phone helpers.
 * Never collect PIN/OTP — number only.
 */

import { normalizePhoneNumber } from "../../auth/access.service.js";

const ZW_MOBILE = /^\+2637\d{8}$/;

export type ZwPhoneValidation =
  | { ok: true; e164: string; displayLocal: string }
  | { ok: false; reason: string };

/** Normalize and validate a Zimbabwe mobile number for EcoCash / OneMoney payer. */
export function validateZimbabweMobileForEcoCash(raw: string): ZwPhoneValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Please enter a mobile number, for example 0772123456." };
  }
  if (/\b(pin|otp|password|passcode|secret)\b/i.test(trimmed)) {
    return {
      ok: false,
      reason: "Never share your EcoCash PIN or OTP. Just send the phone number."
    };
  }

  let candidate = trimmed.replace(/[\s\-()]/g, "");
  // Local formats: 07XXXXXXXX / 7XXXXXXXX
  if (/^0?7\d{8}$/.test(candidate)) {
    candidate = candidate.startsWith("0") ? `+263${candidate.slice(1)}` : `+263${candidate}`;
  } else if (/^2637\d{8}$/.test(candidate)) {
    candidate = `+${candidate}`;
  }

  const e164 = normalizePhoneNumber(candidate);
  if (!ZW_MOBILE.test(e164)) {
    return {
      ok: false,
      reason: "That doesn't look like a Zimbabwe mobile number. Try 0772XXXXXX."
    };
  }

  const local = `0${e164.slice(4)}`; // +2637XXXXXXXX → 07XXXXXXXX
  return { ok: true, e164, displayLocal: local };
}

export function formatZwLocalFromE164(e164: string): string {
  if (ZW_MOBILE.test(e164)) return `0${e164.slice(4)}`;
  return e164;
}
