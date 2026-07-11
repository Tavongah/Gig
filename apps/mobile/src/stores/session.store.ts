import { create } from "zustand";
import { api, type ApiSession, type ApiUser } from "../lib/api";
import { authStorage } from "../lib/auth-storage";
import { defaultActiveRole } from "../lib/auth";

interface SessionState {
  session: ApiSession | null;
  profile: ApiUser | null;
  activeRole: "CLIENT" | "WORKER";
  onboardingComplete: boolean;
  hydrated: boolean;
  bootstrap: () => Promise<void>;
  setSession: (session: ApiSession) => void;
  setProfile: (profile: ApiUser) => void;
  setActiveRole: (role: "CLIENT" | "WORKER") => void;
  setOnboardingComplete: (complete: boolean) => void;
  signOut: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  profile: null,
  activeRole: "CLIENT",
  onboardingComplete: false,
  hydrated: false,
  bootstrap: async () => {
    const token = await authStorage.getToken();
    if (!token) {
      set({ hydrated: true });
      return;
    }

    try {
      const { user } = await api.getMe(token);
      set({
        session: { token, user },
        profile: user,
        activeRole: defaultActiveRole(user),
        onboardingComplete: Boolean(user.profileCompleted),
        hydrated: true
      });
    } catch {
      await authStorage.clearToken();
      set({ session: null, profile: null, hydrated: true });
    }
  },
  setSession: (session) => {
    void authStorage.setToken(session.token);
    set({
      session,
      profile: session.user,
      onboardingComplete: Boolean(session.user.profileCompleted),
      activeRole: defaultActiveRole(session.user)
    });
  },
  setProfile: (profile) =>
    set({
      profile,
      session: get().session ? { ...get().session!, user: profile } : null,
      onboardingComplete: Boolean(profile.profileCompleted)
    }),
  setActiveRole: (activeRole) => set({ activeRole }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  signOut: async () => {
    const token = get().session?.token;
    if (token) {
      try {
        await api.logout(token);
      } catch {
        // ignore network errors on logout
      }
    }
    await authStorage.clearToken();
    set({ session: null, profile: null, activeRole: "CLIENT", onboardingComplete: false });
  }
}));
