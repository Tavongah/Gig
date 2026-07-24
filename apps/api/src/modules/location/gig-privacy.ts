import type { GeocodedAddress } from "@gigflow/shared";
import {
  GIG_SEARCHING_STATUSES,
  buildCustomerPricingView,
  buildWorkerEarningsView
} from "@gigflow/shared";
import type { Gig, GigAssignment, ServiceCategory, User, UserRole } from "@prisma/client";

type GigWithRelations = Gig & {
  serviceCategory?: ServiceCategory | null;
  client?: Pick<User, "id" | "fullName" | "email" | "phoneNumber"> | null;
  assignments?: Array<GigAssignment & { worker?: Pick<User, "id" | "fullName" | "email" | "phoneNumber"> | null }>;
  payment?: { status: string; amountCents: number } | null;
};

export function toGeoPointInput(address: GeocodedAddress) {
  return {
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    formattedAddress: address.formattedAddress,
    latitude: address.latitude,
    longitude: address.longitude
  };
}

export function canWorkerViewFullGigAddress(
  gig: Pick<Gig, "status" | "clientId">,
  viewerId: string,
  assignments: GigAssignment[] = []
): boolean {
  if (gig.clientId === viewerId) {
    return true;
  }
  return assignments.some((assignment) => assignment.workerId === viewerId);
}

function taxRateBpsFromGig(gig: Gig): number {
  const breakdown = gig.priceBreakdown as { taxRateBps?: number } | null;
  return typeof breakdown?.taxRateBps === "number" ? breakdown.taxRateBps : 0;
}

function stripInternalFinancials<T extends Record<string, unknown>>(gig: T): T {
  const {
    workerPayoutCents: _wp,
    platformFeeCents: _pf,
    priceBreakdown: _pb,
    ...rest
  } = gig as T & {
    workerPayoutCents?: unknown;
    platformFeeCents?: unknown;
    priceBreakdown?: unknown;
  };
  return rest as T;
}

/**
 * Role-aware gig payload. Financial privacy is enforced here — not only in the UI.
 */
export function sanitizeGigForViewer<T extends GigWithRelations>(
  gig: T,
  viewerId: string,
  options?: {
    distanceMiles?: number;
    viewerRoles?: UserRole[];
    isAdmin?: boolean;
  }
): T & {
  locationSummary?: string;
  distanceLabel?: string;
  addressHidden?: boolean;
  pricing?: ReturnType<typeof buildCustomerPricingView>;
  earnings?: ReturnType<typeof buildWorkerEarningsView>;
} {
  const roles = options?.viewerRoles ?? [];
  const isAdmin = Boolean(options?.isAdmin || roles.includes("ADMIN" as UserRole));
  const isClientOwner = gig.clientId === viewerId;
  const isAssignedWorker = (gig.assignments ?? []).some((a) => a.workerId === viewerId);
  const isWorkerViewer = isAssignedWorker || roles.includes("WORKER" as UserRole);

  const pricing = buildCustomerPricingView({
    serviceAmountCents:
      gig.status === "COMPLETED" && gig.finalTotalCents != null
        ? Math.max(0, gig.finalTotalCents - (gig.taxCents ?? 0))
        : gig.totalCents,
    taxAmountCents: gig.taxCents ?? 0,
    taxRateBps: taxRateBpsFromGig(gig)
  });

  const earnings = buildWorkerEarningsView({
    workerPayoutCents: gig.workerPayoutCents,
    platformFeeCents: gig.platformFeeCents,
    payoutStatus: gig.paymentStatus
  });

  const assigned = canWorkerViewFullGigAddress(gig, viewerId, gig.assignments ?? []);
  let base: T & {
    locationSummary?: string;
    distanceLabel?: string;
    addressHidden?: boolean;
    pricing?: ReturnType<typeof buildCustomerPricingView>;
    earnings?: ReturnType<typeof buildWorkerEarningsView>;
  };

  if (assigned || !GIG_SEARCHING_STATUSES.includes(gig.status as (typeof GIG_SEARCHING_STATUSES)[number])) {
    base = {
      ...gig,
      distanceLabel: options?.distanceMiles !== undefined ? `${options.distanceMiles} mi away` : undefined
    };
  } else {
    const {
      addressLine1: _line1,
      addressLine2: _line2,
      postalCode: _postal,
      formattedAddress: _formatted,
      latitude: _lat,
      longitude: _lng,
      ...rest
    } = gig;

    base = {
      ...rest,
      addressLine1: "",
      addressLine2: null,
      postalCode: "",
      formattedAddress: null,
      latitude: "0",
      longitude: "0",
      locationSummary: `${gig.city}, ${gig.region}`,
      distanceLabel: options?.distanceMiles !== undefined ? `${options.distanceMiles} mi away` : undefined,
      addressHidden: true
    } as unknown as typeof base;
  }

  if (isAdmin) {
    return { ...base, pricing, earnings };
  }

  if (isClientOwner) {
    const stripped = stripInternalFinancials(base as unknown as Record<string, unknown>);
    return {
      ...stripped,
      totalCents: pricing.serviceAmountCents,
      taxCents: pricing.taxAmountCents,
      finalTotalCents: pricing.totalChargedCents,
      pricing,
      workerPayoutCents: undefined,
      platformFeeCents: undefined,
      priceBreakdown: undefined,
      earnings: undefined
    } as unknown as typeof base;
  }

  if (isWorkerViewer) {
    const stripped = stripInternalFinancials(base as unknown as Record<string, unknown>);
    return {
      ...stripped,
      totalCents: earnings.netEarningsCents,
      workerPayoutCents: earnings.netEarningsCents,
      earnings,
      taxCents: undefined,
      platformFeeCents: undefined,
      priceBreakdown: undefined,
      finalTotalCents: undefined,
      pricing: undefined,
      payment: base.payment
        ? { status: base.payment.status, amountCents: earnings.netEarningsCents }
        : base.payment
    } as unknown as typeof base;
  }

  return stripInternalFinancials(base as unknown as Record<string, unknown>) as unknown as typeof base;
}
