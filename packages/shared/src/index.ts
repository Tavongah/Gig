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

export const onboardingSchema = z.object({
  role: z.enum(userRoles),
  fullName: z.string().min(2).max(100),
  phoneNumber: z.string().min(7).max(24),
  workerProfile: z
    .object({
      serviceCategoryIds: z.array(z.string().uuid()).min(1),
      bio: z.string().min(20).max(500),
      hasVehicle: z.boolean(),
      backgroundCheckConsent: z.boolean(),
      travelDistanceMiles: z.number().min(1).max(50).default(10),
      hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
      minJobAmountCents: z.number().int().min(1000).max(100000).default(5000)
    })
    .optional()
});

export const workerAvailabilitySchema = z.object({
  serviceCategoryIds: z.array(z.string().uuid()).min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  travelDistanceMiles: z.number().min(1).max(50),
  hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
  minJobAmountCents: z.number().int().min(1000).max(100000).default(5000)
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type WorkerAvailabilityInput = z.infer<typeof workerAvailabilitySchema>;

import type { GigEstimateInput } from "./gig-validation.js";
import {
  estimateResponseMinutes as locationEstimateResponseMinutes,
  haversineMiles as locationHaversineMiles
} from "./location.js";

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
  pricingTypes,
  roundBillableMinutes,
  type GigFlowStatus,
  type PricingType
} from "./gig-flow.js";

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
  totalCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  commissionRate: number;
}

export function calculateTieredCommissionRate(totalCents: number): number {
  if (totalCents < 10_000) {
    return 0.2;
  }

  if (totalCents <= 30_000) {
    return 0.15;
  }

  return 0.1;
}

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
  const laborCents =
    pricingType === "FIXED" ? 0 : Math.round(category.hourlyRateCents * input.estimatedHours);
  const distanceFeeCents = Math.round(category.distanceRateCents * input.distanceMiles);
  const subtotal = category.baseRateCents + laborCents + distanceFeeCents;
  const standardTotalCents = Math.round(subtotal * category.multiplier * input.demandMultiplier);
  const totalCents = Math.round(subtotal * category.multiplier * urgencyMultiplier * input.demandMultiplier);
  const urgencyFeeCents = Math.max(0, totalCents - standardTotalCents);
  const commissionRate = calculateTieredCommissionRate(totalCents);
  const platformFeeCents = Math.round(totalCents * commissionRate);

  return {
    baseRateCents: category.baseRateCents,
    hourlyRateCents: category.hourlyRateCents,
    laborCents,
    distanceFeeCents,
    urgencyFeeCents,
    estimatedHours: input.estimatedHours,
    serviceMultiplier: category.multiplier,
    urgencyMultiplier,
    demandMultiplier: input.demandMultiplier,
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
