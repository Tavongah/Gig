import Constants from "expo-constants";
import type {
  CreateGigInput,
  CreateReviewInput,
  GigEstimateInput,
  OnboardingInput,
  WorkerAvailabilityInput
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
  accountStatus?: "ACTIVE" | "SUSPENDED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  isVerified?: boolean;
  phoneNumber?: string | null;
  workerProfile?: {
    bio: string;
    availabilityStatus: string;
    travelDistanceMiles?: number | string;
    hourlyRateCents?: number | null;
    minJobAmountCents?: number;
    currentLatitude?: number | string | null;
    currentLongitude?: number | string | null;
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
}

export interface GigDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  urgency: string;
  totalCents: number;
  workerPayoutCents: number;
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
  serviceCategory?: { id: string; name: string };
  client?: GigPerson;
  assignments?: GigAssignment[];
  paymentStatus?: string;
  payment?: { status: string; amountCents: number };
  chatThread?: { id: string };
}

export interface ChatMessage {
  id: string;
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
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

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
      PAYMENT_REQUIRED: "This gig is not paid yet. The customer must complete payment first."
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
    phoneNumber: string;
    password: string;
    confirmPassword: string;
  }) => request<ApiSession>("/auth/register/customer", { method: "POST", body: JSON.stringify(payload) }),
  registerWorker: (payload: Record<string, unknown>) =>
    request<ApiSession>("/auth/register/worker", { method: "POST", body: JSON.stringify(payload) }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    }),
  logout: (token: string) => request<{ ok: boolean }>("/auth/logout", { method: "POST" }, token),
  createSession: (payload: { email: string; fullName: string; role: "CLIENT" | "WORKER" }) =>
    request<ApiSession>("/auth/session", { method: "POST", body: JSON.stringify(payload) }),
  getMe: (token: string) => request<{ user: ApiUser }>("/auth/me", {}, token),
  completeOnboarding: (payload: OnboardingInput, token: string) =>
    request<{ user: ApiUser }>("/onboarding/complete", { method: "POST", body: JSON.stringify(payload) }, token),
  listCategories: () =>
    request<{ categories: ServiceCategory[]; mvp: ServiceCategory[]; comingSoon: ServiceCategory[] }>("/gigs/categories"),
  estimateGig: (payload: GigEstimateInput, token: string) =>
    request<{ estimate: PriceEstimate }>("/gigs/estimate", { method: "POST", body: JSON.stringify(payload) }, token),
  createGig: (payload: CreateGigInput, token: string) =>
    request<{ gig: GigDetail }>("/gigs", { method: "POST", body: JSON.stringify(payload) }, token),
  getStripeConfig: () => request<{ stripeConfigured: boolean; publishableKey: string | null }>("/payments/config"),
  createCheckoutSession: (gigId: string, token: string) =>
    request<{ checkoutUrl: string | null; alreadyPaid: boolean; payment: PaymentStatusResponse }>(
      "/payments/checkout-session",
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
  setWorkerOffline: (token: string) => request<{ ok: boolean }>("/workers/offline", { method: "POST" }, token),
  myGigs: (token: string, as: "CLIENT" | "WORKER") =>
    request<{ gigs: GigDetail[] }>(`/gigs/mine?as=${as}`, {}, token),
  getGig: (gigId: string, token: string) => request<{ gig: GigDetail }>(`/gigs/${gigId}`, {}, token),
  getChatMessages: (gigId: string, token: string) =>
    request<{ messages: ChatMessage[] }>(`/gigs/${gigId}/chat`, {}, token),
  acceptGig: (gigId: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/accept`, { method: "POST" }, token),
  updateGigStatus: (gigId: string, status: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, token),
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
