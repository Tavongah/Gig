import Constants from "expo-constants";
import type {
  CreateGigInput,
  CreateReviewInput,
  GigEstimateInput,
  OnboardingInput,
  WorkerAvailabilityInput,
  WorkerPreferencesInput
} from "@gigflow/shared";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const apiUrl = extra?.apiUrl ?? "http://localhost:4000/v1";
export const socketUrl = apiUrl.replace("/v1", "");

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  defaultRole?: string;
  authProvider?: "EMAIL" | "GOOGLE" | "APPLE";
  accountStatus?: "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  emailVerified?: boolean;
  phoneVerified?: boolean;
  profileCompleted?: boolean;
  isVerified?: boolean;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  region?: string | null;
  workerProfile?: {
    bio: string;
    availabilityStatus: string;
    travelDistanceMiles?: number | string;
    hourlyRateCents?: number | null;
    minJobAmountCents?: number;
    currentLatitude?: number | string | null;
    currentLongitude?: number | string | null;
    backgroundCheckCompleted?: boolean;
    backgroundCheckConsent?: boolean;
    governmentIdAcknowledged?: boolean;
    serviceCategories: Array<{ id: string; name: string }>;
  } | null;
}

export interface ApiSession {
  token: string;
  user: ApiUser;
}

export interface ServiceCategory {
  id: string;
  name: string;
  description: string;
  iconName: string;
  slug?: string;
  baseRateCents?: number;
  hourlyRateCents?: number;
}

export interface AvailableWorker {
  id: string;
  userId: string;
  fullName: string;
  ratingAverage: number;
  completedGigCount: number;
  distanceMiles: number;
  estimatedResponseMinutes: number;
  hourlyRateCents: number | null;
  minJobAmountCents: number;
  services: Array<{ id: string; name: string; slug: string }>;
}

export interface WorkerProfileSummary {
  ratingAverage?: number | string;
  completedGigCount?: number;
  currentLatitude?: number | string | null;
  currentLongitude?: number | string | null;
}

export interface GigPerson {
  id: string;
  fullName: string;
  email?: string;
  phoneNumber?: string | null;
  workerProfile?: WorkerProfileSummary | null;
}

export interface GigAssignment {
  id: string;
  workerId: string;
  worker?: GigPerson;
  acceptedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  endedAt?: string | null;
  billableMinutes?: number | null;
}

export interface GigWorkerInterest {
  id: string;
  status: string;
  offeredWorkerPayoutCents: number;
  estimatedHours: number;
  estimatedArrivalMinutes?: number | null;
  message?: string | null;
  distanceMiles?: number | null;
  worker: {
    id: string;
    fullName: string;
    avatarUrl?: string | null;
    emailVerified?: boolean;
    phoneVerified?: boolean;
    ratingAverage: number;
    completedGigCount: number;
    hourlyRateCents?: number | null;
  };
}

export interface GigSelectionSummary {
  gig: {
    id: string;
    title: string;
    serviceCategoryName: string;
    pricingType: string;
    estimatedHours: number;
    paymentStatus: string;
    status: string;
    billingIncrementMinutes?: number;
  };
  worker: GigWorkerInterest["worker"];
  pricing: {
    serviceAmountCents?: number;
    taxAmountCents?: number;
    taxCents?: number;
    taxRateBps?: number;
    customerFeeCents?: number;
    totalChargedCents?: number;
    workerChargeCents?: number;
    platformFeeCents?: number;
    estimatedTotalCents: number;
    hourlyRateCents?: number;
    authorizationBufferCents?: number;
    maximumAuthorizedAmountCents?: number;
    billingIncrementMinutes?: number;
    isTimeBased?: boolean;
  };
}

export interface GigDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  urgency: string;
  totalCents: number;
  taxCents?: number;
  workerPayoutCents?: number;
  pricing?: {
    serviceAmountCents: number;
    taxAmountCents: number;
    taxRateBps: number;
    customerFeeCents: number;
    totalChargedCents: number;
    currency: string;
  };
  earnings?: {
    grossEarningsCents: number;
    platformDeductionCents: number;
    netEarningsCents: number;
    tipsCents: number;
    payoutStatus: string;
    currency: string;
  };
  addressLine1: string;
  city: string;
  region: string;
  formattedAddress?: string | null;
  locationSummary?: string;
  distanceLabel?: string;
  addressHidden?: boolean;
  latitude: string | number;
  longitude: string | number;
  startsAt: string;
  createdAt: string;
  estimatedHours?: number | string;
  distanceMiles?: number;
  estimatedResponseMinutes?: number;
  assignedWorkerId?: string | null;
  serviceCategory?: { id: string; name: string };
  client?: GigPerson;
  assignments?: GigAssignment[];
  paymentStatus?: string;
  pricingType?: string;
  finalTotalCents?: number | null;
  payment?: { status: string; amountCents: number };
  chatThread?: { id: string };
}

export interface ChatMessage {
  id: string;
  gigId?: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender?: { id: string; fullName: string };
}

export interface PriceEstimate {
  baseRateCents: number;
  hourlyRateCents: number;
  laborCents: number;
  urgencyFeeCents: number;
  estimatedHours: number;
  totalCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  commissionRate: number;
  urgencyMultiplier: number;
  taxRateBps?: number;
  taxAmountCents?: number;
  customerTotalCents?: number;
}

export interface WorkerEarnings {
  totalEarningsCents: number;
  availableBalanceCents: number;
  withdrawnBalanceCents: number;
  pendingEarningsCents: number;
  completedGigCount: number;
  platformFeesCents: number;
  payoutStatus: string;
  stripeConnect?: {
    connected: boolean;
    accountId: string | null;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  };
  transactions: Array<{
    id: string;
    type: string;
    label: string;
    status: string;
    amountCents: number;
    gigId: string | null;
    gigTitle: string | null;
    failureReason: string | null;
    createdAt: string;
  }>;
  recentPayouts: Array<{
    gigId: string;
    title: string;
    workerPayoutCents: number;
    completedAt: string;
  }>;
}

export interface PaymentStatusResponse {
  id: string;
  paymentStatus: string;
  lifecycleStatus: string;
  status?: string;
  amountCents: number;
  platformFeeCents: number;
  workerPayoutCents: number;
  estimatedPrice?: number;
  platformFee?: number;
  workerPayout?: number;
  isPaid: boolean;
  isAuthorized?: boolean;
  checkoutUrl?: string | null;
}

export interface GigReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer?: { id: string; fullName: string };
  reviewee?: { id: string; fullName: string };
}

export class ApiValidationError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors).join(". "));
    this.name = "ApiValidationError";
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
  } catch {
    throw new Error("Unable to reach Duts right now. Check your internet connection and try again.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      error?: string;
      code?: string;
      errors?: Record<string, string>;
      details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
    } | null;

    if (body?.errors && Object.keys(body.errors).length > 0) {
      throw new ApiValidationError(body.errors);
    }

    const fieldMessages = body?.details?.fieldErrors
      ? Object.values(body.details.fieldErrors).flat().filter(Boolean)
      : [];
    const apiErrorMessages: Record<string, string> = {
      FORBIDDEN: "Your account cannot post gigs. Log in as a customer or switch to client mode in Profile.",
      AUTH_REQUIRED: "Your session expired. Please log in again.",
      INVALID_TOKEN: "Your session expired. Please log in again.",
      STRIPE_CONNECT_REQUIRED: "Connect Stripe in Earnings before withdrawing.",
      WORKER_NOT_APPROVED: "Your worker account must be approved before you can accept gigs.",
      PAYMENT_REQUIRED: "This gig is not paid yet. The customer must complete payment first.",
      EMAIL_NOT_VERIFIED: "Please verify your email before continuing. Check your inbox for the link.",
      EMAIL_NOT_CONFIGURED: "Email delivery is not configured on the server yet. Contact Duts Support.",
      EMAIL_SEND_FAILED: "We couldn’t send that email right now. Please try again in a few minutes.",
      EMAIL_RESEND_RATE_LIMITED: "Too many verification emails sent. Please try again later.",
      INVALID_RESET_TOKEN: "That password reset link is invalid or expired. Request a new one.",
      INVALID_VERIFICATION_TOKEN: "That verification link is invalid or expired. Request a new one.",
      PHONE_NOT_VERIFIED: "Phone verification is not required right now. Continue with email verification.",
      PROFILE_INCOMPLETE: "Complete your profile before continuing.",
      EMAIL_IN_USE: "That email is already registered.",
      PHONE_IN_USE: "That phone number is already linked to another account.",
      OTP_RATE_LIMITED: "Too many code requests. Try again later.",
      OTP_INVALID: "Invalid verification code.",
      OTP_EXPIRED: "Verification code expired. Request a new one.",
      OTP_LOCKED: "Too many failed attempts. Request a new code.",
      USE_SOCIAL_LOGIN: "This account uses social sign-in instead of a password.",
      FIREBASE_NOT_CONFIGURED: "Social sign-in is not configured on the server yet.",
      DEV_PAYMENT_DISABLED: "Payment bypass is disabled in production. Configure Stripe on the server.",
      GPS_REQUIRED: "Location is required for this action.",
      GPS_VERIFICATION_FAILED: "Move closer to the customer's address before continuing."
    };
    const message =
      fieldMessages.length > 0
        ? fieldMessages.join(". ")
        : (apiErrorMessages[body?.code ?? body?.error ?? ""] ??
            apiErrorMessages[body?.error ?? ""] ??
            body?.errors?.stripe ??
            body?.errors?.worker ??
            body?.errors?.payment ??
            body?.error ??
            `Request failed with status ${response.status}`);
    const error = new Error(message) as Error & { code?: string };
    error.code = body?.code;
    throw error;
  }

  return response.json() as Promise<T>;
}

export const api = {
  login: (payload: { email: string; password: string }) =>
    request<ApiSession>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  registerCustomer: (payload: {
    fullName: string;
    email: string;
    phoneNumber?: string;
    password: string;
    confirmPassword: string;
    acceptTerms: true;
  }) => request<ApiSession>("/auth/register/customer", { method: "POST", body: JSON.stringify(payload) }),
  registerWorker: (payload: Record<string, unknown>) =>
    request<ApiSession>("/auth/register/worker", { method: "POST", body: JSON.stringify(payload) }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  resetPassword: (payload: { token: string; password: string; confirmPassword: string }) =>
    request<ApiSession>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  requestEmailVerification: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/verify-email/request", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  logout: (token: string) => request<{ ok: boolean }>("/auth/logout", { method: "POST" }, token),
  createSession: (payload: { email: string; fullName: string; role: "CLIENT" | "WORKER" }) =>
    request<ApiSession>("/auth/session", { method: "POST", body: JSON.stringify(payload) }),
  getMe: (token: string) => request<{ user: ApiUser }>("/auth/me", {}, token),
  updateProfile: (
    payload: { fullName?: string; phoneNumber?: string | null; avatarUrl?: string | null },
    token: string
  ) =>
    request<{ user: ApiUser }>("/auth/me", { method: "PATCH", body: JSON.stringify(payload) }, token),
  uploadAvatar: (imageDataUrl: string | null, token: string) =>
    request<{ user: ApiUser }>(
      "/auth/me/avatar",
      { method: "POST", body: JSON.stringify({ imageDataUrl }) },
      token
    ),
  changePassword: (
    payload: { currentPassword: string; password: string; confirmPassword: string },
    token: string
  ) =>
    request<{ ok: boolean }>("/auth/change-password", { method: "POST", body: JSON.stringify(payload) }, token),
  deleteAccount: (token: string) => request<{ ok: boolean }>("/auth/me", { method: "DELETE" }, token),
  listPaymentMethods: (token: string) =>
    request<{
      stripeConfigured: boolean;
      methods: Array<{
        id: string;
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
        isDefault: boolean;
      }>;
    }>("/payments/methods", {}, token),
  removePaymentMethod: (paymentMethodId: string, token: string) =>
    request<{ ok: boolean }>(`/payments/methods/${paymentMethodId}`, { method: "DELETE" }, token),
  setDefaultPaymentMethod: (paymentMethodId: string, token: string) =>
    request<{ ok: boolean }>(
      "/payments/methods/default",
      { method: "POST", body: JSON.stringify({ paymentMethodId }) },
      token
    ),
  createPaymentMethodsPortal: (token: string) =>
    request<{ url: string }>("/payments/methods/portal", { method: "POST" }, token),
  getAuthConfig: () =>
    request<{ firebaseConfigured: boolean; socialProviders: { google: boolean; apple: boolean } }>("/auth/config"),
  socialLogin: (payload: { provider: "google" | "apple"; idToken: string; intendedRole: "CLIENT" | "WORKER" }) =>
    request<ApiSession & { needsProfileCompletion?: boolean }>("/auth/social", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  resendEmailVerification: (token: string) =>
    request<{ ok: boolean }>("/auth/verify-email/resend", { method: "POST" }, token),
  requestPhoneOtp: (phoneNumber: string, token: string) =>
    request<{ ok: boolean; devCode?: string }>(
      "/auth/verify-phone/request",
      { method: "POST", body: JSON.stringify({ phoneNumber }) },
      token
    ),
  verifyPhoneOtp: (payload: { phoneNumber: string; code: string }, token: string) =>
    request<{ ok: boolean; user: ApiUser }>(
      "/auth/verify-phone/confirm",
      { method: "POST", body: JSON.stringify(payload) },
      token
    ),
  completeProfile: (payload: Record<string, unknown>, token: string) =>
    request<{ user: ApiUser }>("/auth/complete-profile", { method: "POST", body: JSON.stringify(payload) }, token),
  completeOnboarding: (payload: OnboardingInput, token: string) =>
    request<{ user: ApiUser }>("/onboarding/complete", { method: "POST", body: JSON.stringify(payload) }, token),
  listCategories: () =>
    request<{ categories: ServiceCategory[]; mvp: ServiceCategory[]; comingSoon: ServiceCategory[] }>("/gigs/categories"),
  estimateGig: (payload: GigEstimateInput, token: string) =>
    request<{ estimate: PriceEstimate }>("/gigs/estimate", { method: "POST", body: JSON.stringify(payload) }, token),
  createGig: (payload: CreateGigInput, token: string, options?: { idempotencyKey?: string }) =>
    request<{ success?: boolean; gigId?: string; status?: string; gig: GigDetail }>(
      "/gigs",
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined
      },
      token
    ),
  getStripeConfig: () => request<{ stripeConfigured: boolean; publishableKey: string | null }>("/payments/config"),
  createCheckoutSession: (gigId: string, token: string) =>
    request<{ checkoutUrl: string | null; alreadyPaid: boolean; payment: PaymentStatusResponse }>(
      "/payments/checkout-session",
      { method: "POST", body: JSON.stringify({ gigId }) },
      token
    ),
  createPaymentIntent: (gigId: string, token: string) =>
    request<{ clientSecret: string | null; alreadyPaid: boolean; payment: PaymentStatusResponse }>(
      "/payments/payment-intent",
      { method: "POST", body: JSON.stringify({ gigId }) },
      token
    ),
  getPaymentStatus: (gigId: string, token: string) =>
    request<{ payment: PaymentStatusResponse }>(`/payments/gigs/${gigId}/status`, {}, token),
  getConnectStatus: (token: string) =>
    request<{ connect: { connected: boolean; accountId: string | null; payoutsEnabled: boolean; detailsSubmitted: boolean } }>(
      "/payments/connect/status",
      {},
      token
    ),
  createConnectAccountLink: (token: string) =>
    request<{ url: string; accountId: string }>("/payments/connect/account-link", { method: "POST" }, token),
  publishGigWithoutPayment: (gigId: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/publish`, { method: "POST" }, token),
  nearbyGigs: (token: string) => request<{ gigs: GigDetail[] }>("/gigs/nearby", {}, token),
  availableWorkersNearby: (latitude: number, longitude: number, token: string, radiusMiles = 20) =>
    request<{ workers: AvailableWorker[] }>(
      `/workers/available-nearby?latitude=${latitude}&longitude=${longitude}&radiusMiles=${radiusMiles}`,
      {},
      token
    ),
  updateWorkerAvailability: (payload: WorkerAvailabilityInput, token: string) =>
    request<{ profile: ApiUser["workerProfile"] }>(
      "/workers/availability",
      { method: "PATCH", body: JSON.stringify(payload) },
      token
    ),
  updateWorkerPreferences: (payload: WorkerPreferencesInput, token: string) =>
    request<{ profile: ApiUser["workerProfile"] }>(
      "/workers/preferences",
      { method: "PATCH", body: JSON.stringify(payload) },
      token
    ),
  setWorkerOffline: (token: string) => request<{ ok: boolean }>("/workers/offline", { method: "POST" }, token),
  myGigs: (token: string, as: "CLIENT" | "WORKER") =>
    request<{ gigs: GigDetail[] }>(`/gigs/mine?as=${as}`, {}, token),
  getGig: (gigId: string, token: string) => request<{ gig: GigDetail }>(`/gigs/${gigId}`, {}, token),
  getChatMessages: (gigId: string, token: string) =>
    request<{ messages: ChatMessage[] }>(`/gigs/${gigId}/chat`, {}, token),
  sendChatMessage: (gigId: string, body: string, token: string) =>
    request<{ message: ChatMessage }>(
      `/gigs/${gigId}/chat`,
      { method: "POST", body: JSON.stringify({ body }) },
      token
    ),
  acceptGig: (gigId: string, token: string) =>
    request<{ gig: GigDetail & { gigId?: string }; interest?: { gigId: string } }>(
      `/gigs/${gigId}/accept`,
      { method: "POST" },
      token
    ),
  getWorkerMatchingInterest: (gigId: string, token: string) =>
    request<{
      interest: {
        id: string;
        status: string;
        offeredWorkerPayoutCents: number;
        estimatedArrivalMinutes: number | null;
        estimatedHours: number;
        createdAt: string;
      };
      gig: {
        id: string;
        title: string;
        status: string;
        paymentStatus: string;
        city: string;
        region: string;
        startsAt: string;
        estimatedHours: number;
        workerPayoutCents: number;
        totalCents: number;
        urgency: string;
        size: string;
        serviceCategory: { id: string; name: string };
        assignedWorkerId: string | null;
      };
    }>(`/gigs/${gigId}/my-interest`, {}, token),
  listWorkerMatchingInterests: (token: string) =>
    request<{
      interests: Array<{
        id: string;
        status: string;
        offeredWorkerPayoutCents: number;
        gig: {
          id: string;
          title: string;
          status: string;
          city: string;
          region: string;
          startsAt: string;
          estimatedHours: number;
          workerPayoutCents: number;
          serviceCategory: { id: string; name: string };
          assignedWorkerId: string | null;
        };
      }>;
    }>("/gigs/worker/matching", {}, token),
  withdrawGigInterest: (gigId: string, token: string) =>
    request<{ withdrawn: boolean; gigId: string }>(`/gigs/${gigId}/withdraw-interest`, { method: "POST" }, token),
  cancelGigByWorker: (gigId: string, reason: string, token: string) =>
    request<{ rematching: boolean; status: string }>(
      `/gigs/${gigId}/cancel-by-worker`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token
    ),
  updateGigStatus: (
    gigId: string,
    status: string,
    token: string,
    location?: { latitude: number; longitude: number }
  ) =>
    request<{ gig: GigDetail }>(
      `/gigs/${gigId}/status`,
      { method: "PATCH", body: JSON.stringify({ status, ...location }) },
      token
    ),
  listGigInterests: (gigId: string, token: string) =>
    request<{ interests: GigWorkerInterest[] }>(`/gigs/${gigId}/interests`, {}, token),
  getWorkerSelectionSummary: (gigId: string, workerId: string, token: string) =>
    request<GigSelectionSummary>(`/gigs/${gigId}/selection/${workerId}`, {}, token),
  selectWorker: (gigId: string, workerId: string, token: string) =>
    request<GigSelectionSummary>(`/gigs/${gigId}/select-worker`, {
      method: "POST",
      body: JSON.stringify({ workerId })
    }, token),
  authorizeGigWithoutStripe: (gigId: string, token: string) =>
    request<GigSelectionSummary>(`/gigs/${gigId}/authorize-without-stripe`, { method: "POST" }, token),
  approveGigCompletion: (gigId: string, token: string) =>
    request<{ ok: boolean }>(`/gigs/${gigId}/approve-completion`, { method: "POST" }, token),
  approveExtraTime: (gigId: string, extraMinutes: number, token: string) =>
    request<{ ok: boolean }>(`/gigs/${gigId}/approve-extra-time`, {
      method: "POST",
      body: JSON.stringify({ extraMinutes })
    }, token),
  cancelGig: (gigId: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) }, token),
  getWorkerEarnings: (token: string) => request<{ earnings: WorkerEarnings }>("/workers/earnings", {}, token),
  withdrawWorkerEarnings: (token: string, amountCents?: number) =>
    request<{ ok: boolean; amountCents: number; transferId: string; transactionId: string }>(
      "/workers/withdraw",
      { method: "POST", body: JSON.stringify(amountCents ? { amountCents } : {}) },
      token
    ),
  getWorkerWithdrawOnboardingLink: (token: string) =>
    request<{ url: string; accountId: string }>("/workers/withdraw/onboarding-link", { method: "POST" }, token),
  autocompleteAddress: (query: string, token: string) =>
    request<{ suggestions: Array<{ placeId: string; label: string; formattedAddress: string }> }>(
      `/location/autocomplete?q=${encodeURIComponent(query)}`,
      {},
      token
    ),
  geocodeAddress: (
    payload: { query?: string; placeId?: string; latitude?: number; longitude?: number },
    token: string
  ) => request<{ location: import("@gigflow/shared").GeoPointInput }>("/location/geocode", { method: "POST", body: JSON.stringify(payload) }, token),
  reverseGeocode: (latitude: number, longitude: number, token: string) =>
    request<{ location: import("@gigflow/shared").GeoPointInput }>(
      "/location/reverse-geocode",
      { method: "POST", body: JSON.stringify({ latitude, longitude }) },
      token
    ),
  updateWorkerLocation: (
    payload: { latitude: number; longitude: number; formattedAddress?: string; query?: string; placeId?: string },
    token: string
  ) => request<{ profile: ApiUser["workerProfile"] }>("/workers/location", { method: "PATCH", body: JSON.stringify(payload) }, token),
  createReview: (gigId: string, payload: CreateReviewInput, token: string) =>
    request<{ review: GigReview }>(`/gigs/${gigId}/reviews`, { method: "POST", body: JSON.stringify(payload) }, token),
  getGigReviews: (gigId: string, token: string) =>
    request<{ reviews: GigReview[] }>(`/gigs/${gigId}/reviews`, {}, token)
};
