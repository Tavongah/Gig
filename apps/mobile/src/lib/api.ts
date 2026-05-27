import Constants from "expo-constants";
import type { CreateGigInput, GigEstimateInput, OnboardingInput } from "@gigflow/shared";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const apiUrl = extra?.apiUrl ?? "http://localhost:4000/v1";
export const socketUrl = apiUrl.replace("/v1", "");

export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isVerified?: boolean;
  phoneNumber?: string | null;
  workerProfile?: {
    bio: string;
    availabilityStatus: string;
    serviceCategories: Array<{ id: string; name: string }>;
  } | null;
}

export interface ApiSession {
  token: string;
  user: ApiUser;
}

export interface GigPerson {
  id: string;
  fullName: string;
  email?: string;
  phoneNumber?: string | null;
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
  latitude: string | number;
  longitude: string | number;
  startsAt: string;
  createdAt: string;
  serviceCategory?: { id: string; name: string };
  client?: GigPerson;
  assignments?: GigAssignment[];
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
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  createSession: (payload: { email: string; fullName: string; role: "CLIENT" | "WORKER" }) =>
    request<ApiSession>("/auth/session", { method: "POST", body: JSON.stringify(payload) }),
  getMe: (token: string) => request<{ user: ApiUser }>("/auth/me", {}, token),
  completeOnboarding: (payload: OnboardingInput, token: string) =>
    request<{ user: ApiUser }>("/onboarding/complete", { method: "POST", body: JSON.stringify(payload) }, token),
  listCategories: () =>
    request<{ categories: Array<{ id: string; name: string; description: string; iconName: string }> }>("/gigs/categories"),
  estimateGig: (payload: GigEstimateInput, token: string) =>
    request<{ estimate: { totalCents: number; platformFeeCents: number; workerPayoutCents: number } }>(
      "/gigs/estimate",
      { method: "POST", body: JSON.stringify(payload) },
      token
    ),
  createGig: (payload: CreateGigInput, token: string) =>
    request<{ gig: GigDetail }>("/gigs", { method: "POST", body: JSON.stringify(payload) }, token),
  nearbyGigs: (token: string) => request<{ gigs: GigDetail[] }>("/gigs/nearby", {}, token),
  myGigs: (token: string, as: "CLIENT" | "WORKER") =>
    request<{ gigs: GigDetail[] }>(`/gigs/mine?as=${as}`, {}, token),
  getGig: (gigId: string, token: string) => request<{ gig: GigDetail }>(`/gigs/${gigId}`, {}, token),
  getChatMessages: (gigId: string, token: string) =>
    request<{ messages: ChatMessage[] }>(`/gigs/${gigId}/chat`, {}, token),
  acceptGig: (gigId: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/accept`, { method: "POST" }, token),
  updateGigStatus: (gigId: string, status: string, token: string) =>
    request<{ gig: GigDetail }>(`/gigs/${gigId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }, token)
};
