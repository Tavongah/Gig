import Constants from "expo-constants";
import type { CreateGigInput, GigEstimateInput, OnboardingInput } from "@gigflow/shared";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
export const apiUrl = extra?.apiUrl ?? "http://localhost:4000/v1";

export interface ApiSession {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
  };
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
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  createSession: (payload: { email: string; fullName: string; role: "CLIENT" | "WORKER" }) =>
    request<ApiSession>("/auth/session", { method: "POST", body: JSON.stringify(payload) }),
  completeOnboarding: (payload: OnboardingInput, token: string) =>
    request<{ user: ApiSession["user"] }>("/onboarding/complete", { method: "POST", body: JSON.stringify(payload) }, token),
  listCategories: () =>
    request<{ categories: Array<{ id: string; name: string; description: string; iconName: string }> }>("/gigs/categories"),
  estimateGig: (payload: GigEstimateInput, token: string) =>
    request<{ estimate: { totalCents: number; platformFeeCents: number; workerPayoutCents: number } }>(
      "/gigs/estimate",
      { method: "POST", body: JSON.stringify(payload) },
      token
    ),
  createGig: (payload: CreateGigInput, token: string) =>
    request<{ gig: { id: string; title: string; totalCents: number; status: string } }>(
      "/gigs",
      { method: "POST", body: JSON.stringify(payload) },
      token
    ),
  nearbyGigs: (token: string) =>
    request<{ gigs: Array<{ id: string; title: string; totalCents: number; workerPayoutCents: number }> }>(
      "/gigs/nearby",
      {},
      token
    )
};
