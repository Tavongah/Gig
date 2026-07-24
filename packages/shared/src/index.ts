import { z } from "zod";

export const userRoles = ["CLIENT", "WORKER", "ADMIN"] as const;
export const launchPhases = ["MVP", "PHASE_2"] as const;
export const gigStatuses = [
  "POSTED",
  "WORKER_SELECTED",
  "SEARCHING_FOR_WORKER",
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS",
  "WAITING_EXTRA_TIME_APPROVAL",
  "WAITING_CUSTOMER_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
  "DRAFT",
  "DISPUTED"
] as const;

export const defaultCommissionRate = 0.2;
export const urgencyMultipliers = {
  STANDARD: 1,
  SOON: 1.15,
  URGENT: 1.3
} as const;

export type UserRole = (typeof userRoles)[number];
export type LaunchPhase = (typeof launchPhases)[number];
export type GigStatus = (typeof gigStatuses)[number];

export { MAX_WORKER_TRAVEL_MILES, MAX_CHAT_MESSAGE_LENGTH, MAX_AVATAR_URL_LENGTH } from "./limits.js";
import { MAX_WORKER_TRAVEL_MILES } from "./limits.js";

export const geoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressLine1: z.string().min(5).max(150),
  addressLine2: z.string().max(160).optional(),
  city: z.string().min(2).max(80),
  region: z.string().min(2).max(80),
  postalCode: z.string().min(3).max(20),
  country: z.string().length(2).default("US")
});

export const onboardingSchema = z
  .object({
    role: z.enum(["CLIENT", "WORKER"]),
    fullName: z.string().min(2).max(100),
    phoneNumber: z.string().min(7).max(24),
    workerProfile: z
      .object({
        serviceCategoryIds: z.array(z.string().uuid()).min(1),
        bio: z.string().min(20).max(500),
        hasVehicle: z.boolean(),
        backgroundCheckConsent: z.literal(true),
        travelDistanceMiles: z.number().min(1).max(MAX_WORKER_TRAVEL_MILES).default(10),
        hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
        minJobAmountCents: z.number().int().min(1000).max(100000).default(5000)
      })
      .optional()
  })
  .superRefine((data, ctx) => {
    if (data.role === "WORKER" && !data.workerProfile) {
      ctx.addIssue({
        code: "custom",
        path: ["workerProfile"],
        message: "Worker profile details are required."
      });
    }
  });

export const workerAvailabilitySchema = z.object({
  serviceCategoryIds: z.array(z.string().uuid()).min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  travelDistanceMiles: z.number().min(1).max(MAX_WORKER_TRAVEL_MILES),
  hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
  minJobAmountCents: z.number().int().min(1000).max(100000).default(5000)
});

/** Update gig filters without going online or sending GPS. */
export const workerPreferencesSchema = z.object({
  serviceCategoryIds: z.array(z.string().uuid()).min(1),
  travelDistanceMiles: z.number().min(1).max(MAX_WORKER_TRAVEL_MILES),
  hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
  minJobAmountCents: z.number().int().min(1000).max(100000).default(5000)
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type WorkerAvailabilityInput = z.infer<typeof workerAvailabilitySchema>;
export type WorkerPreferencesInput = z.infer<typeof workerPreferencesSchema>;

import type { GigEstimateInput } from "./gig-validation.js";
import {
  estimateResponseMinutes as locationEstimateResponseMinutes,
  haversineMiles as locationHaversineMiles
} from "./location.js";
import { resolveHourlyRateCents } from "./pricing-constants.js";

export {
  DEFAULT_MATCHING_RADIUS_MILES,
  GIG_SEARCHING_STATUSES,
  MAX_COORDINATE_DRIFT_MILES,
  compareWorkersForMatching,
  coordinatesAreConsistent,
  formatDistanceMiles,
  getEffectiveMatchingRadiusMiles,
  getGigMatchingRadiusMiles,
  isWithinMatchingRadius,
  type AddressSuggestion,
  type GeocodedAddress,
  type GigSize,
  type GigUrgency as LocationGigUrgency,
  type RankedWorkerCandidate
} from "./location.js";

export {
  ALLOWED_PHOTO_MIME_TYPES,
  BOOKING_TIME_BUFFER_MINUTES,
  GIG_VALIDATION_MESSAGES,
  MAX_DESCRIPTION_LENGTH,
  MAX_GIG_PHOTOS,
  MAX_PHOTO_BYTES,
  MAX_PREFERRED_DAYS_AHEAD,
  MIN_DESCRIPTION_LENGTH,
  MVP_SERVICE_SLUGS,
  buildCreateGigPayload,
  buildStartsAtIso,
  createGigSchema,
  getBookingWindow,
  gigEstimateSchema,
  isPostGigFormComplete,
  isValidPreferredDateTime,
  mapValidationPath,
  postGigLocationSchema,
  preferredDateTimeError,
  sanitizeUserText,
  validatePhotoFile,
  validatePhotoReference,
  validatePostGigForm,
  zodErrorsToFieldMap,
  type CreateGigInput,
  type GeoPointInput,
  type GigEstimateInput,
  type GigUrgency,
  type PostGigFormValues,
  type PostGigPhoto,
  type PostGigValidationResult
} from "./gig-validation.js";

export { createReviewSchema, type CreateReviewInput } from "./review-validation.js";
export { paymentLifecycleStatuses, type PaymentLifecycleStatus } from "./payment.js";
export {
  formatMoney,
  gigFlowStatuses,
  gigNeedsCompletionApproval,
  gigNeedsExtraTimeApproval,
  gigNeedsPaymentAfterWorkerSelection,
  gigNeedsWorkerSelection,
  isCustomerRematching,
  isFixedPricing,
  isTimeBasedPricing,
  calculateTimeBasedAuthorization,
  billableSecondsFromWorkWindow,
  pricingTypes,
  roundBillableMinutes,
  workerCancelOutcome,
  type GigFlowStatus,
  type PricingType
} from "./gig-flow.js";

export {
  DEFAULT_BILLING_INCREMENT_MINUTES,
  DEFAULT_HOURLY_RATE,
  DEFAULT_HOURLY_RATE_CENTS,
  formatHourlyRateLabel,
  resolveHourlyRateCents
} from "./pricing-constants.js";

export {
  isRequestGigPricingType,
  recommendedPricingForService,
  resolvePricingType,
  REQUEST_GIG_PRICING_TYPES,
  SERVICE_PRICING_RECOMMENDATIONS,
  type PricingDecisionInput,
  type RequestGigPricingType
} from "./pricing-recommendations.js";

export {
  CUSTOMER_JOURNEY_PROGRESS,
  customerJourneyHeadline,
  customerJourneyProgressIndex,
  customerJourneyStageLabel,
  customerJourneyStages,
  liveTrackingWorkerStatus,
  resolveCustomerJourneyStage,
  type CustomerJourneyStage
} from "./customer-journey.js";

export {
  accountStatuses,
  changePasswordSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  workerRegisterSchema,
  socialLoginSchema,
  phoneOtpRequestSchema,
  phoneOtpVerifySchema,
  completeProfileSchema,
  type AccountStatus,
  type AuthProvider,
  type ChangePasswordInput,
  type CompleteProfileInput,
  type CustomerRegisterInput,
  type ForgotPasswordInput,
  type LoginInput,
  type PhoneOtpRequestInput,
  type PhoneOtpVerifyInput,
  type ResetPasswordInput,
  type SocialLoginInput,
  type WorkerRegisterInput
} from "./auth.js";

export interface PriceBreakdown {
  baseRateCents: number;
  hourlyRateCents: number;
  laborCents: number;
  distanceFeeCents: number;
  urgencyFeeCents: number;
  estimatedHours: number;
  serviceMultiplier: number;
  urgencyMultiplier: number;
  demandMultiplier: number;
  /** Service charge before tax (customer-facing subtotal). */
  totalCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  commissionRate: number;
  /** Applied when location is known (estimate/create). */
  taxRateBps?: number;
  taxAmountCents?: number;
  /** totalCents + taxAmountCents (+ customer fee if any). */
  customerTotalCents?: number;
}

export {
  CT_SALES_TAX_RATE_BPS,
  calculateApplicableTaxCents,
  calculateCustomerTotalCents,
  resolveTaxRateBps,
  type TaxCalculation,
  type TaxLocationInput
} from "./tax.js";

export {
  buildCustomerPricingView,
  buildWorkerEarningsView,
  type AdminFinancialView,
  type CustomerPricingView,
  type WorkerEarningsView
} from "./financial-views.js";

export { DUTS_JOURNEY_LABELS, gigStatusLabel, type DutsJourneyStatus } from "./gig-status-map.js";

export { APP_BRAND, brandSanitizeText } from "./brand.js";

export { DUTS_FLOW_EVENTS, type DutsFlowEvent, type DutsFlowLogPayload } from "./flow-events.js";


export function calculateTieredCommissionRate(totalCents: number): number {
  if (totalCents < 10_000) {
    return 0.2;
  }

  if (totalCents <= 30_000) {
    return 0.15;
  }

  return 0.1;
}

/**
 * MVP pricing:
 * - FIXED: predefined category base rate (no hourly labor).
 * - Timed (HOURLY / ESTIMATE_TIMER): Hours × DEFAULT_HOURLY_RATE ($25/hr).
 *   Base rate is not added for timed jobs so customer total tracks Hours × $25.
 */
export function calculatePriceEstimate(
  input: GigEstimateInput,
  category: {
    baseRateCents: number;
    hourlyRateCents: number;
    distanceRateCents: number;
    multiplier: number;
  }
): PriceBreakdown {
  const urgencyMultiplier = urgencyMultipliers[input.urgency];
  const pricingType = input.pricingType ?? "FIXED";
  const demandMultiplier = input.demandMultiplier ?? 1;
  const isFixed = pricingType === "FIXED";
  const hourlyRateCents = resolveHourlyRateCents(pricingType);
  const laborCents = isFixed ? 0 : Math.round(hourlyRateCents * input.estimatedHours);
  const baseRateCents = isFixed ? category.baseRateCents : 0;
  const distanceFeeCents = Math.round(category.distanceRateCents * input.distanceMiles);
  // Timed MVP: Hours × $25 (no category multiplier). Fixed keeps category multiplier.
  const serviceMultiplier = isFixed ? category.multiplier : 1;
  const subtotal = baseRateCents + laborCents + distanceFeeCents;
  const standardTotalCents = Math.round(subtotal * serviceMultiplier * demandMultiplier);
  const totalCents = Math.round(subtotal * serviceMultiplier * urgencyMultiplier * demandMultiplier);
  const urgencyFeeCents = Math.max(0, totalCents - standardTotalCents);
  const commissionRate = calculateTieredCommissionRate(totalCents);
  const platformFeeCents = Math.round(totalCents * commissionRate);

  return {
    baseRateCents,
    hourlyRateCents,
    laborCents,
    distanceFeeCents,
    urgencyFeeCents,
    estimatedHours: input.estimatedHours,
    serviceMultiplier,
    urgencyMultiplier,
    demandMultiplier,
    totalCents,
    platformFeeCents,
    workerPayoutCents: totalCents - platformFeeCents,
    commissionRate
  };
}

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return locationHaversineMiles(lat1, lon1, lat2, lon2);
}

export function estimateResponseMinutes(distanceMiles: number): number {
  return locationEstimateResponseMinutes(distanceMiles);
}
