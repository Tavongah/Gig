import { z } from "zod";
import { MAX_WORKER_TRAVEL_MILES } from "./limits.js";

export const accountStatuses = [
  "ACTIVE",
  "SUSPENDED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED"
] as const;

export type AccountStatus = (typeof accountStatuses)[number];

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Password must include a letter")
  .regex(/[0-9]/, "Password must include a number");

const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email")
  .transform((value) => value.toLowerCase());

/** Optional for MVP launch; phone verification comes later. */
const optionalPhoneSchema = z
  .string()
  .trim()
  .max(24)
  .optional()
  .transform((value) => {
    if (!value || value.length === 0) return undefined;
    return value;
  })
  .refine((value) => value === undefined || value.length >= 7, {
    message: "Enter a valid phone number"
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required")
});

export const customerRegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(100),
    email: emailSchema,
    phoneNumber: optionalPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      error: "Please accept the Terms of Service and Privacy Policy"
    })
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  });

export const workerRegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name is required").max(100),
    email: emailSchema,
    phoneNumber: optionalPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      error: "Please accept the Terms of Service and Privacy Policy"
    }),
    bio: z.string().min(20, "Bio must be at least 20 characters").max(500),
    serviceCategoryIds: z.array(z.string().uuid()).min(1, "Select at least one service"),
    city: z.string().min(2, "City is required").max(80),
    serviceArea: z.string().min(2, "Service area is required").max(120),
    travelDistanceMiles: z.number().min(1).max(MAX_WORKER_TRAVEL_MILES),
    workExperience: z.string().min(10, "Work experience is required").max(500),
    availabilityNotes: z.string().max(200).optional(),
    hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
    minJobAmountCents: z.number().int().min(1000).max(100000).default(5000),
    hasVehicle: z.boolean().default(false),
    profilePhotoDataUrl: z
      .string()
      .min(32, "Profile photo is required")
      .max(400_000, "Profile photo is too large. Compress and try again.")
      .refine((value) => /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value), {
        message: "Upload a JPEG, PNG, or WebP profile photo"
      }),
    governmentIdType: z.enum(["DRIVERS_LICENSE", "STATE_ID", "NATIONAL_ID"], {
      error: "Select a government ID type"
    }),
    governmentIdFrontDataUrl: z
      .string()
      .min(32, "Government ID front image is required")
      .max(400_000, "ID image is too large. Compress and try again.")
      .refine((value) => /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value), {
        message: "Upload a JPEG, PNG, or WebP ID image"
      }),
    governmentIdBackDataUrl: z
      .string()
      .min(32)
      .max(400_000, "ID image is too large. Compress and try again.")
      .refine((value) => /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value), {
        message: "Upload a JPEG, PNG, or WebP ID image"
      })
      .optional(),
    governmentIdAcknowledged: z.literal(true, {
      error: "Government ID acknowledgment is required"
    }),
    proofOfAddressAcknowledged: z.literal(true, {
      error: "Proof of address acknowledgment is required"
    }),
    platformRulesAgreed: z.literal(true, {
      error: "You must agree to platform rules"
    }),
    backgroundCheckConsent: z.literal(true, {
      error: "Background check consent is required"
    })
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  })
  .refine(
    (data) =>
      data.governmentIdType === "NATIONAL_ID" || Boolean(data.governmentIdBackDataUrl),
    {
      message: "Government ID back image is required for this ID type",
      path: ["governmentIdBackDataUrl"]
    }
  );

export const forgotPasswordSchema = z.object({
  email: emailSchema
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  })
  .refine((data) => data.currentPassword !== data.password, {
    message: "New password must be different from your current password",
    path: ["password"]
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type WorkerRegisterInput = z.infer<typeof workerRegisterSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const authProviders = ["EMAIL", "GOOGLE", "APPLE"] as const;
export type AuthProvider = (typeof authProviders)[number];

export const socialLoginSchema = z.object({
  provider: z.enum(["google", "apple"]),
  idToken: z.string().min(20, "Missing sign-in token"),
  intendedRole: z.enum(["CLIENT", "WORKER"]).default("CLIENT")
});

export const phoneOtpRequestSchema = z.object({
  phoneNumber: z.string().min(7, "Enter a valid phone number").max(24)
});

export const phoneOtpVerifySchema = z.object({
  phoneNumber: z.string().min(7).max(24),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code")
});

export const completeProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: emailSchema.optional(),
  phoneNumber: optionalPhoneSchema,
  defaultRole: z.enum(["CLIENT", "WORKER"]),
  avatarUrl: z.string().url().max(2048).optional(),
  location: z
    .object({
      formattedAddress: z.string().min(5).max(200),
      addressLine1: z.string().min(5).max(150),
      city: z.string().min(2).max(80),
      region: z.string().min(2).max(80),
      postalCode: z.string().min(3).max(20),
      country: z.string().length(2).default("US"),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180)
    })
    .optional()
});

export type SocialLoginInput = z.infer<typeof socialLoginSchema>;
export type PhoneOtpRequestInput = z.infer<typeof phoneOtpRequestSchema>;
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifySchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
