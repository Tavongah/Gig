import { z } from "zod";
import type { PricingType } from "./gig-flow";

export const MVP_SERVICE_SLUGS = [
  "moving-assistance",
  "house-cleaning",
  "room-cleaning",
  "lawn-cutting",
  "short-term-labor",
  "car-detailing",
  "furniture-assembly",
  "junk-removal",
  "event-help"
] as const;

export const GIG_VALIDATION_MESSAGES = {
  serviceType: "Please select a valid service type.",
  title: "Job title must be between 5 and 80 characters.",
  description: "Please describe the job in at least 10 characters.",
  estimatedHours: "Estimated time must be a number between 1 and 12 hours.",
  location: "Please enter a valid job location.",
  locationUnverified: "Confirm a verified address before requesting help.",
  urgency: "Please select urgency.",
  preferredDateTime: "Please select a valid date and time.",
  preferredDateTimePast: "This time has already passed. Please select another time.",
  preferredDateTimeFuture: "Please choose a future time.",
  preferredDateTimeMax: "Bookings can only be scheduled up to 30 days in advance.",
  photos: "Photos must be JPG, PNG, or WEBP and 5MB or smaller.",
  photoType: "Photos must be JPG, PNG, or WEBP.",
  photoSize: "Each photo must be 5MB or smaller.",
  photoCount: "You can upload up to 5 photos."
} as const;

export const ALLOWED_PHOTO_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
export const MAX_GIG_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PREFERRED_DAYS_AHEAD = 30;
export const BOOKING_TIME_BUFFER_MINUTES = 15;
export const MIN_DESCRIPTION_LENGTH = 10;
export const MAX_DESCRIPTION_LENGTH = 1000;

export type GigUrgency = "STANDARD" | "SOON" | "URGENT";

export type PostGigPhoto = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type PostGigFormValues = {
  serviceCategoryId: string | null;
  serviceCategoryName: string | null;
  description: string;
  pricingType: PricingType;
  estimatedHours: string;
  locationAddress: string;
  urgency: GigUrgency | "";
  preferredDate: string;
  preferredTime: string;
  photos: PostGigPhoto[];
};

export type PostGigValidationResult = {
  success: boolean;
  errors: Record<string, string>;
  payload?: CreateGigInput;
};

export function trimText(value: string): string {
  return value.trim();
}

export function isNonEmptyTrimmed(value: string): boolean {
  return trimText(value).length > 0;
}

/** Strip HTML/script-like content from user-generated text. */
export function sanitizeUserText(value: string): string {
  return trimText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/javascript:/gi, "")
    .replace(/\s+/g, " ");
}

function trimmedString(min: number, max: number, message: string) {
  return z.preprocess(
    (value) => (typeof value === "string" ? sanitizeUserText(value) : value),
    z.string().min(min, message).max(max, message).refine((value) => value.length > 0, message)
  );
}

export function getBookingWindow(now = new Date()): {
  minDate: Date;
  maxDate: Date;
  earliestStartsAt: Date;
} {
  const minDate = new Date(now);
  minDate.setHours(0, 0, 0, 0);

  const maxDate = new Date(minDate);
  maxDate.setDate(maxDate.getDate() + MAX_PREFERRED_DAYS_AHEAD);
  maxDate.setHours(23, 59, 59, 999);

  const earliestStartsAt = new Date(now.getTime() + BOOKING_TIME_BUFFER_MINUTES * 60 * 1000);

  return { minDate, maxDate, earliestStartsAt };
}

export function buildStartsAtIso(date: string, time: string): string {
  const safeDate = trimText(date);
  const safeTime = trimText(time);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safeDate);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(safeTime);
  if (!dateMatch || !timeMatch) {
    return "";
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }

  const startsAt = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (Number.isNaN(startsAt.getTime())) {
    return "";
  }

  // Reject overflow dates (e.g. Feb 31) and absurd years like 2036 from bad pickers.
  if (
    startsAt.getFullYear() !== year ||
    startsAt.getMonth() !== month - 1 ||
    startsAt.getDate() !== day ||
    startsAt.getHours() !== hours ||
    startsAt.getMinutes() !== minutes
  ) {
    return "";
  }

  return startsAt.toISOString();
}

export function preferredDateTimeError(startsAtIso: string, now = new Date()): string | null {
  if (!startsAtIso) {
    return GIG_VALIDATION_MESSAGES.preferredDateTime;
  }

  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    return GIG_VALIDATION_MESSAGES.preferredDateTime;
  }

  const { maxDate, earliestStartsAt } = getBookingWindow(now);

  if (startsAt.getTime() < earliestStartsAt.getTime()) {
    const sameDay =
      startsAt.getFullYear() === now.getFullYear() &&
      startsAt.getMonth() === now.getMonth() &&
      startsAt.getDate() === now.getDate();
    return sameDay
      ? GIG_VALIDATION_MESSAGES.preferredDateTimePast
      : GIG_VALIDATION_MESSAGES.preferredDateTimeFuture;
  }

  if (startsAt.getTime() > maxDate.getTime()) {
    return GIG_VALIDATION_MESSAGES.preferredDateTimeMax;
  }

  return null;
}

export function isValidPreferredDateTime(startsAtIso: string, now = new Date()): boolean {
  return preferredDateTimeError(startsAtIso, now) === null;
}

export function validatePhotoFile(file: { type: string; size: number }): string | null {
  const normalizedType = file.type.toLowerCase();
  if (!ALLOWED_PHOTO_MIME_TYPES.includes(normalizedType as (typeof ALLOWED_PHOTO_MIME_TYPES)[number])) {
    return GIG_VALIDATION_MESSAGES.photoType;
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return GIG_VALIDATION_MESSAGES.photoSize;
  }

  return null;
}

export function validatePhotoReference(value: string): string | null {
  if (value.startsWith("data:")) {
    const match = value.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
    if (!match) {
      return GIG_VALIDATION_MESSAGES.photoType;
    }

    const base64 = value.split(",")[1] ?? "";
    const sizeBytes = Math.ceil((base64.length * 3) / 4);
    if (sizeBytes > MAX_PHOTO_BYTES) {
      return GIG_VALIDATION_MESSAGES.photoSize;
    }

    return null;
  }

  if (/\.(jpe?g|png|webp)$/i.test(value)) {
    return null;
  }

  return GIG_VALIDATION_MESSAGES.photoType;
}

const startsAtSchema = z
  .string()
  .datetime({ message: GIG_VALIDATION_MESSAGES.preferredDateTime })
  .superRefine((value, ctx) => {
    const message = preferredDateTimeError(value);
    if (message) {
      ctx.addIssue({ code: "custom", message });
    }
  });

const gigPhotoSchema = z.string().superRefine((value, ctx) => {
  const message = validatePhotoReference(value);
  if (message) {
    ctx.addIssue({ code: "custom", message });
  }
});

export const postGigLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressLine1: trimmedString(5, 150, GIG_VALIDATION_MESSAGES.location),
  addressLine2: z.preprocess(
    (value) => (typeof value === "string" ? trimText(value) : value),
    z.string().max(160).optional()
  ),
  city: z.preprocess(
    (value) => (typeof value === "string" ? trimText(value) : value),
    z.string().min(2).max(80)
  ),
  region: z.preprocess(
    (value) => (typeof value === "string" ? trimText(value) : value),
    z.string().min(2).max(80)
  ),
  postalCode: z.preprocess(
    (value) => (typeof value === "string" ? trimText(value) : value),
    z.string().min(3).max(20)
  ),
  country: z.string().length(2).default("US"),
  formattedAddress: trimmedString(8, 240, GIG_VALIDATION_MESSAGES.location)
});

export const gigEstimateSchema = z.object({
  serviceCategoryId: z.string().uuid({ message: GIG_VALIDATION_MESSAGES.serviceType }),
  location: postGigLocationSchema,
  estimatedHours: z
    .number({ message: GIG_VALIDATION_MESSAGES.estimatedHours })
    .min(1, GIG_VALIDATION_MESSAGES.estimatedHours)
    .max(12, GIG_VALIDATION_MESSAGES.estimatedHours),
  distanceMiles: z.number().nonnegative().max(250).default(0),
  urgency: z.enum(["STANDARD", "SOON", "URGENT"], { message: GIG_VALIDATION_MESSAGES.urgency }),
  startsAt: startsAtSchema,
  demandMultiplier: z.number().min(1).max(3).default(1),
  pricingType: z.enum(["FIXED", "HOURLY", "ESTIMATE_TIMER"]).default("FIXED"),
  description: z.string().max(1000).optional(),
  size: z.enum(["SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]).default("MEDIUM")
});

export const createGigSchema = gigEstimateSchema.extend({
  title: trimmedString(5, 80, GIG_VALIDATION_MESSAGES.title),
  description: trimmedString(MIN_DESCRIPTION_LENGTH, MAX_DESCRIPTION_LENGTH, GIG_VALIDATION_MESSAGES.description),
  pricingType: z.enum(["FIXED", "HOURLY", "ESTIMATE_TIMER"]).default("FIXED"),
  photos: z.array(gigPhotoSchema).max(MAX_GIG_PHOTOS, GIG_VALIDATION_MESSAGES.photoCount).default([])
});

export type GeoPointInput = z.infer<typeof postGigLocationSchema>;
export type GigEstimateInput = z.infer<typeof gigEstimateSchema>;
export type CreateGigInput = z.infer<typeof createGigSchema>;

const FIELD_PATH_MAP: Record<string, string> = {
  serviceCategoryId: "serviceType",
  title: "title",
  description: "description",
  pricingType: "pricingType",
  estimatedHours: "estimatedHours",
  urgency: "urgency",
  startsAt: "preferredDateTime",
  photos: "photos"
};

export function mapValidationPath(path: (string | number)[]): string {
  if (path[0] === "location" && path[1] === "addressLine1") {
    return "location";
  }

  const key = String(path[0] ?? "form");
  return FIELD_PATH_MAP[key] ?? key;
}

export function zodErrorsToFieldMap(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = mapValidationPath(issue.path as (string | number)[]);
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }

  return errors;
}

export function buildCreateGigPayload(
  values: PostGigFormValues,
  geocodedLocation: GeoPointInput
): CreateGigInput {
  return {
    title: sanitizeUserText(values.serviceCategoryName ?? ""),
    description: sanitizeUserText(values.description),
    serviceCategoryId: values.serviceCategoryId ?? "",
    estimatedHours: Number(values.estimatedHours),
    distanceMiles: 0,
    urgency: values.urgency as GigUrgency,
    startsAt: buildStartsAtIso(values.preferredDate, values.preferredTime),
    demandMultiplier: 1,
    size: "MEDIUM",
    pricingType: values.pricingType,
    photos: values.photos.map((photo) => photo.uri),
    location: geocodedLocation
  };
}

export function validatePostGigForm(
  values: PostGigFormValues,
  allowedCategoryIds: string[],
  geocodedLocation?: GeoPointInput | null,
  now = new Date()
): PostGigValidationResult {
  const errors: Record<string, string> = {};

  if (!values.serviceCategoryId || !allowedCategoryIds.includes(values.serviceCategoryId)) {
    errors.serviceType = GIG_VALIDATION_MESSAGES.serviceType;
  }

  const title = sanitizeUserText(values.serviceCategoryName ?? "");
  if (!values.serviceCategoryId || !isNonEmptyTrimmed(title) || title.length < 5 || title.length > 80) {
    errors.serviceType = errors.serviceType ?? GIG_VALIDATION_MESSAGES.serviceType;
  }

  const description = sanitizeUserText(values.description);
  if (!isNonEmptyTrimmed(values.description) || description.length < MIN_DESCRIPTION_LENGTH || description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = GIG_VALIDATION_MESSAGES.description;
  }

  const hours = Number(values.estimatedHours);
  if (values.pricingType === "ESTIMATE_TIMER") {
    if (!Number.isFinite(hours) || hours < 1 || hours > 12) {
      errors.estimatedHours = GIG_VALIDATION_MESSAGES.estimatedHours;
    }
  } else if (!Number.isFinite(hours) || hours < 1 || hours > 12) {
    errors.estimatedHours = GIG_VALIDATION_MESSAGES.estimatedHours;
  }

  const location = trimText(values.locationAddress);
  if (!isNonEmptyTrimmed(values.locationAddress) || location.length < 5 || location.length > 240) {
    errors.location = GIG_VALIDATION_MESSAGES.location;
  }

  if (!geocodedLocation) {
    errors.location = errors.location ?? GIG_VALIDATION_MESSAGES.locationUnverified;
  }

  if (!values.urgency || !["STANDARD", "SOON", "URGENT"].includes(values.urgency)) {
    errors.urgency = GIG_VALIDATION_MESSAGES.urgency;
  }

  if (!values.pricingType || !["FIXED", "HOURLY", "ESTIMATE_TIMER"].includes(values.pricingType)) {
    errors.pricingType = "Pricing could not be determined for this request.";
  }

  const startsAt = buildStartsAtIso(values.preferredDate, values.preferredTime);
  const dateTimeError = preferredDateTimeError(startsAt, now);
  if (dateTimeError) {
    errors.preferredDateTime = dateTimeError;
  }

  if (values.photos.length > MAX_GIG_PHOTOS) {
    errors.photos = GIG_VALIDATION_MESSAGES.photoCount;
  } else {
    for (const photo of values.photos) {
      const fileError = validatePhotoFile({ type: photo.mimeType, size: photo.sizeBytes });
      if (fileError) {
        errors.photos = fileError;
        break;
      }

      const referenceError = validatePhotoReference(photo.uri);
      if (referenceError) {
        errors.photos = referenceError;
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  const payload = buildCreateGigPayload(values, geocodedLocation!);
  const parsed = createGigSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, errors: zodErrorsToFieldMap(parsed.error) };
  }

  // Re-check booking window after schema parse (time may have advanced).
  const submitDateError = preferredDateTimeError(parsed.data.startsAt, now);
  if (submitDateError) {
    return { success: false, errors: { preferredDateTime: submitDateError } };
  }

  return { success: true, errors: {}, payload: parsed.data };
}


export function isPostGigFormComplete(
  values: PostGigFormValues,
  allowedCategoryIds: string[],
  geocodedLocation?: GeoPointInput | null
): boolean {
  return validatePostGigForm(values, allowedCategoryIds, geocodedLocation).success;
}
