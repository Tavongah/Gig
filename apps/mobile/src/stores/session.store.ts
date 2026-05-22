import { create } from "zustand";
import type { ApiSession } from "../lib/api";

interface SessionState {
  session: ApiSession | null;
  activeRole: "CLIENT" | "WORKER";
  setSession: (session: ApiSession) => void;
  setActiveRole: (role: "CLIENT" | "WORKER") => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  activeRole: "CLIENT",
  setSession: (session) => set({ session }),
  setActiveRole: (activeRole) => set({ activeRole }),
  signOut: () => set({ session: null, activeRole: "CLIENT" })
}));
