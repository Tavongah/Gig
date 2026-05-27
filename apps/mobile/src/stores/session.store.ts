import { create } from "zustand";
import type { ApiSession, ApiUser } from "../lib/api";

interface SessionState {
  session: ApiSession | null;
  profile: ApiUser | null;
  activeRole: "CLIENT" | "WORKER";
  onboardingComplete: boolean;
  setSession: (session: ApiSession) => void;
  setProfile: (profile: ApiUser) => void;
  setActiveRole: (role: "CLIENT" | "WORKER") => void;
  setOnboardingComplete: (complete: boolean) => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  profile: null,
  activeRole: "CLIENT",
  onboardingComplete: false,
  setSession: (session) => set({ session, profile: session.user, onboardingComplete: session.user.isVerified ?? false }),
  setProfile: (profile) =>
    set({
      profile,
      onboardingComplete: profile.isVerified ?? false
    }),
  setActiveRole: (activeRole) => set({ activeRole }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  signOut: () => set({ session: null, profile: null, activeRole: "CLIENT", onboardingComplete: false })
}));
