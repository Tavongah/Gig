import { z } from "zod";

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
  description: "Please describe the job in at least 20 characters.",
  estimatedHours: "Estimated hours must be between 1 and 12.",
  location: "Please enter a valid job location.",
  urgency: "Please select urgency.",
  preferredDateTime: "Please choose a future date within 30 days.",
  photos: "Photos must be JPG, PNG, or WEBP and 5MB or smaller.",
  photoType: "Photos must be JPG, PNG, or WEBP.",
  photoSize: "Each photo must be 5MB or smaller.",
  photoCount: "You can upload up to 5 photos."
} as const;

export const ALLOWED_PHOTO_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
export const MAX_GIG_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PREFERRED_DAYS_AHEAD = 30;

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

function trimmedString(min: number, max: number, message: string) {
  return z.preprocess(
    (value) => (typeof value === "string" ? trimText(value) : value),
    z.string().min(min, message).max(max, message).refine((value) => value.length > 0, message)
  );
}

export function buildStartsAtIso(date: string, time: string): string {
  const safeDate = trimText(date);
  const safeTime = trimText(time) || "12:00";
  if (!safeDate) {
    return "";
  }

  const startsAt = new Date(`${safeDate}T${safeTime}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return "";
  }

  return startsAt.toISOString();
}

export function isValidPreferredDateTime(startsAtIso: string, now = new Date()): boolean {
  if (!startsAtIso) {
    return false;
  }

  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    return false;
  }

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + MAX_PREFERRED_DAYS_AHEAD);
  return startsAt > now && startsAt <= maxDate;
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
    if (!isValidPreferredDateTime(value)) {
      ctx.addIssue({ code: "custom", message: GIG_VALIDATION_MESSAGES.preferredDateTime });
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
  demandMultiplier: z.number().min(1).max(3).default(1)
});

export const createGigSchema = gigEstimateSchema.extend({
  title: trimmedString(5, 80, GIG_VALIDATION_MESSAGES.title),
  description: trimmedString(20, 1000, GIG_VALIDATION_MESSAGES.description),
  size: z.enum(["SMALL", "MEDIUM", "LARGE", "ENTERPRISE"]).default("MEDIUM"),
  photos: z.array(gigPhotoSchema).max(MAX_GIG_PHOTOS, GIG_VALIDATION_MESSAGES.photoCount).default([])
});

export type GeoPointInput = z.infer<typeof postGigLocationSchema>;
export type GigEstimateInput = z.infer<typeof gigEstimateSchema>;
export type CreateGigInput = z.infer<typeof createGigSchema>;

const FIELD_PATH_MAP: Record<string, string> = {
  serviceCategoryId: "serviceType",
  title: "title",
  description: "description",
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
    title: trimText(values.serviceCategoryName ?? ""),
    description: trimText(values.description),
    serviceCategoryId: values.serviceCategoryId ?? "",
    estimatedHours: Number(values.estimatedHours),
    distanceMiles: 0,
    urgency: values.urgency as GigUrgency,
    startsAt: buildStartsAtIso(values.preferredDate, values.preferredTime),
    demandMultiplier: 1,
    size: "MEDIUM",
    photos: values.photos.map((photo) => photo.uri),
    location: geocodedLocation
  };
}

export function validatePostGigForm(
  values: PostGigFormValues,
  allowedCategoryIds: string[],
  geocodedLocation?: GeoPointInput | null
): PostGigValidationResult {
  const errors: Record<string, string> = {};

  if (!values.serviceCategoryId || !allowedCategoryIds.includes(values.serviceCategoryId)) {
    errors.serviceType = GIG_VALIDATION_MESSAGES.serviceType;
  }

  const title = trimText(values.serviceCategoryName ?? "");
  if (!values.serviceCategoryId || !isNonEmptyTrimmed(title) || title.length < 5 || title.length > 80) {
    errors.serviceType = errors.serviceType ?? GIG_VALIDATION_MESSAGES.serviceType;
  }

  const description = trimText(values.description);
  if (!isNonEmptyTrimmed(values.description) || description.length < 20 || description.length > 1000) {
    errors.description = GIG_VALIDATION_MESSAGES.description;
  }

  const hours = Number(values.estimatedHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 12) {
    errors.estimatedHours = GIG_VALIDATION_MESSAGES.estimatedHours;
  }

  const location = trimText(values.locationAddress);
  if (!isNonEmptyTrimmed(values.locationAddress) || location.length < 5 || location.length > 150) {
    errors.location = GIG_VALIDATION_MESSAGES.location;
  }

  if (!geocodedLocation) {
    errors.location = errors.location ?? "Confirm a valid address before posting.";
  }

  if (!values.urgency || !["STANDARD", "SOON", "URGENT"].includes(values.urgency)) {
    errors.urgency = GIG_VALIDATION_MESSAGES.urgency;
  }

  const startsAt = buildStartsAtIso(values.preferredDate, values.preferredTime);
  if (!isValidPreferredDateTime(startsAt)) {
    errors.preferredDateTime = GIG_VALIDATION_MESSAGES.preferredDateTime;
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

  return { success: true, errors: {}, payload: parsed.data };
}

export function isPostGigFormComplete(
  values: PostGigFormValues,
  allowedCategoryIds: string[],
  geocodedLocation?: GeoPointInput | null
): boolean {
  return validatePostGigForm(values, allowedCategoryIds, geocodedLocation).success;
}
