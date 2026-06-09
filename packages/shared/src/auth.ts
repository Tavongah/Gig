import { z } from "zod";

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
  .max(128, "Password is too long");

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required")
});

export const customerRegisterSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required").max(100),
    email: z.string().email("Enter a valid email"),
    phoneNumber: z.string().min(7, "Phone number is required").max(24),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"]
  });

export const workerRegisterSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required").max(100),
    email: z.string().email("Enter a valid email"),
    phoneNumber: z.string().min(7, "Phone number is required").max(24),
    password: passwordSchema,
    confirmPassword: z.string(),
    bio: z.string().min(20, "Bio must be at least 20 characters").max(500),
    serviceCategoryIds: z.array(z.string().uuid()).min(1, "Select at least one service"),
    city: z.string().min(2, "City is required").max(80),
    serviceArea: z.string().min(2, "Service area is required").max(120),
    travelDistanceMiles: z.number().min(1).max(50),
    workExperience: z.string().min(10, "Work experience is required").max(500),
    availabilityNotes: z.string().max(200).optional(),
    hourlyRateCents: z.number().int().min(1000).max(50000).optional(),
    minJobAmountCents: z.number().int().min(1000).max(100000).default(5000),
    hasVehicle: z.boolean().default(false),
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
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email")
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

export type LoginInput = z.infer<typeof loginSchema>;
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type WorkerRegisterInput = z.infer<typeof workerRegisterSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
