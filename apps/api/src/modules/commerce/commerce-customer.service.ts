/**
 * Lightweight commerce customer identity (WhatsApp / guest web / app).
 * Does not create authenticated User accounts for WhatsApp shoppers.
 * Future verified phone linking is prepared but not auto-merged.
 */

import { CommerceCustomerSource, type CommerceCustomer } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";
import { normalizePhoneNumber } from "../auth/access.service.js";

const MARKETPLACE_CLIENT_EMAIL = "marketplace-client@duts.internal";

export type EnsureWhatsAppCommerceCustomerResult = CommerceCustomer & {
  /** True when a new row was created for this call. */
  created: boolean;
};

/** Normalize to E.164 when possible; returns null for empty input. */
export function normalizeCommercePhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let candidate = raw.trim().replace(/[\s\-()]/g, "");
  // Zimbabwe local mobile: 07XXXXXXXX / 7XXXXXXXX
  if (/^0?7\d{8}$/.test(candidate)) {
    candidate = candidate.startsWith("0") ? `+263${candidate.slice(1)}` : `+263${candidate}`;
  } else if (/^2637\d{8}$/.test(candidate)) {
    candidate = `+${candidate}`;
  }
  return normalizePhoneNumber(candidate);
}

/**
 * WhatsApp first/returning shopper — create or reuse CommerceCustomer by whatsappPhone.
 * Never creates a User account.
 */
export async function ensureWhatsAppCommerceCustomer(
  phone: string,
  displayName?: string
): Promise<EnsureWhatsAppCommerceCustomerResult> {
  const whatsappPhone = normalizeCommercePhone(phone);
  if (!whatsappPhone) {
    throw new AppError("Invalid WhatsApp phone.", 400, "INVALID_PHONE");
  }

  const existing = await prisma.commerceCustomer.findUnique({
    where: { whatsappPhone }
  });
  if (existing) {
    const name = displayName?.trim();
    if (name && (!existing.displayName || existing.displayName.startsWith("WhatsApp "))) {
      const updated = await prisma.commerceCustomer.update({
        where: { id: existing.id },
        data: { displayName: name }
      });
      return { ...updated, created: false };
    }
    return { ...existing, created: false };
  }

  const created = await prisma.commerceCustomer.create({
    data: {
      source: CommerceCustomerSource.WHATSAPP,
      whatsappPhone,
      primaryPhone: whatsappPhone,
      displayName: displayName?.trim() || `WhatsApp ${whatsappPhone.slice(-4)}`,
      userId: null
    }
  });
  return { ...created, created: true };
}

/** Guest website checkout identity — no User required. */
export async function ensureWebGuestCommerceCustomer(input: {
  phone?: string | null;
  displayName?: string | null;
}): Promise<CommerceCustomer> {
  const phone = normalizeCommercePhone(input.phone ?? null);
  const name = input.displayName?.trim() || null;

  if (phone) {
    const byWhatsApp = await prisma.commerceCustomer.findUnique({
      where: { whatsappPhone: phone }
    });
    if (byWhatsApp) {
      return prisma.commerceCustomer.update({
        where: { id: byWhatsApp.id },
        data: {
          primaryPhone: byWhatsApp.primaryPhone ?? phone,
          ...(name && !byWhatsApp.displayName ? { displayName: name } : {})
        }
      });
    }

    const byPrimary = await prisma.commerceCustomer.findFirst({
      where: { primaryPhone: phone, source: CommerceCustomerSource.WEB_GUEST }
    });
    if (byPrimary) {
      return prisma.commerceCustomer.update({
        where: { id: byPrimary.id },
        data: {
          ...(name && !byPrimary.displayName ? { displayName: name } : {})
        }
      });
    }
  }

  return prisma.commerceCustomer.create({
    data: {
      source: CommerceCustomerSource.WEB_GUEST,
      primaryPhone: phone,
      whatsappPhone: null,
      displayName: name,
      userId: null
    }
  });
}

/** Authenticated app user → CommerceCustomer (reuse by userId). */
export async function ensureAppCommerceCustomer(userId: string): Promise<CommerceCustomer> {
  const existing = await prisma.commerceCustomer.findFirst({
    where: { userId }
  });
  if (existing) return existing;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const phone = user.phoneNumber ? normalizeCommercePhone(user.phoneNumber) : null;

  // Do not steal another WhatsApp customer's unique whatsappPhone without verified linking.
  let whatsappPhone: string | null = null;
  if (phone) {
    const taken = await prisma.commerceCustomer.findUnique({ where: { whatsappPhone: phone } });
    if (!taken) whatsappPhone = phone;
  }

  return prisma.commerceCustomer.create({
    data: {
      source: CommerceCustomerSource.APP,
      userId: user.id,
      primaryPhone: phone,
      whatsappPhone,
      displayName: user.fullName
    }
  });
}

/**
 * Future verified linking: attach a CommerceCustomer to a User when phone is verified.
 * Does NOT merge by name. Refuses unsafe collisions.
 */
export async function linkCommerceCustomerToVerifiedUser(input: {
  commerceCustomerId: string;
  userId: string;
  /** Caller must confirm the User's phone is verified and matches. */
  verifiedPhoneE164: string;
}): Promise<CommerceCustomer> {
  const phone = normalizeCommercePhone(input.verifiedPhoneE164);
  if (!phone) {
    throw new AppError("Verified phone required to link identities.", 400, "INVALID_PHONE");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });
  if (!user.phoneVerified || normalizeCommercePhone(user.phoneNumber) !== phone) {
    throw new AppError(
      "Cannot link: user phone is not verified or does not match.",
      403,
      "PHONE_NOT_VERIFIED"
    );
  }

  const customer = await prisma.commerceCustomer.findUniqueOrThrow({
    where: { id: input.commerceCustomerId }
  });

  const customerPhone = customer.whatsappPhone || customer.primaryPhone;
  if (!customerPhone || customerPhone !== phone) {
    throw new AppError(
      "Cannot link: commerce customer phone does not match verified phone.",
      409,
      "PHONE_MISMATCH"
    );
  }

  if (customer.userId && customer.userId !== user.id) {
    throw new AppError(
      "Commerce customer is already linked to another account.",
      409,
      "ALREADY_LINKED"
    );
  }

  const other = await prisma.commerceCustomer.findFirst({
    where: { userId: user.id, id: { not: customer.id } }
  });
  if (other) {
    throw new AppError(
      "User already has a linked commerce customer. Manual merge required.",
      409,
      "USER_ALREADY_HAS_COMMERCE_CUSTOMER"
    );
  }

  return prisma.commerceCustomer.update({
    where: { id: customer.id },
    data: {
      userId: user.id,
      primaryPhone: customer.primaryPhone ?? phone
    }
  });
}

/**
 * Gig.clientId still requires a User. WhatsApp shoppers without a linked User
 * use a single internal marketplace client; real contact stays on dropoff / WA phone.
 */
export async function resolveDeliveryClientUserId(
  commerceCustomer: Pick<CommerceCustomer, "userId">
): Promise<string> {
  if (commerceCustomer.userId) return commerceCustomer.userId;
  return ensureMarketplaceDeliveryClientUserId();
}

export async function ensureMarketplaceDeliveryClientUserId(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: MARKETPLACE_CLIENT_EMAIL } });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: {
      email: MARKETPLACE_CLIENT_EMAIL,
      fullName: "DUTS Marketplace",
      phoneNumber: null,
      roles: ["CLIENT"],
      defaultRole: "CLIENT",
      accountStatus: "ACTIVE",
      emailVerified: true,
      phoneVerified: false,
      profileCompleted: true,
      country: "ZW",
      city: "Harare",
      region: "Harare",
      avatarUrl: "https://api.dicebear.com/9.x/shapes/svg?seed=duts-marketplace"
    }
  });
  return created.id;
}

/** Resolve commerceCustomerId for order create — accepts User id (compat) or CommerceCustomer id. */
export async function resolveCommerceCustomerForOrder(input: {
  commerceCustomerId?: string | null;
  customerId?: string | null;
}): Promise<{ commerceCustomerId: string; customerId: string | null }> {
  if (input.commerceCustomerId) {
    const cc = await prisma.commerceCustomer.findUniqueOrThrow({
      where: { id: input.commerceCustomerId }
    });
    return {
      commerceCustomerId: cc.id,
      customerId: input.customerId ?? cc.userId ?? null
    };
  }
  if (input.customerId) {
    const cc = await ensureAppCommerceCustomer(input.customerId);
    return { commerceCustomerId: cc.id, customerId: input.customerId };
  }
  throw new AppError(
    "commerceCustomerId or customerId is required.",
    400,
    "COMMERCE_CUSTOMER_REQUIRED"
  );
}
