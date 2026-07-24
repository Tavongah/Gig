import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  MAX_WORKER_TRAVEL_MILES,
  workerAvailabilitySchema,
  zodErrorsToFieldMap
} from "@gigflow/shared";
import { api } from "../lib/api";
import { getCurrentCoordinates } from "../lib/location";
import { canWorkerGoOnline, needsProfilePhoto } from "../lib/auth";
import { showAlert, showConfirm } from "../lib/confirm";
import { hasWorkerPreferencesConfigured, workerPreferencesFromProfile } from "../components/WorkerPreferencesForm";
import { useSocket } from "./useSocket";
import type { RootStackParamList } from "../navigation/types";
import { useSessionStore } from "../stores/session.store";

export function useWorkerOnline() {
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const setProfile = useSessionStore((state) => state.setProfile);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const socket = useSocket();

  const [isOnline, setIsOnline] = useState(profile?.workerProfile?.availabilityStatus === "AVAILABLE");
  const [isGoingOnline, setIsGoingOnline] = useState(false);

  const preferences = useMemo(() => workerPreferencesFromProfile(profile), [profile]);
  const preferencesReady = hasWorkerPreferencesConfigured(profile);

  useFocusEffect(
    useCallback(() => {
      setIsOnline(profile?.workerProfile?.availabilityStatus === "AVAILABLE");
    }, [profile?.workerProfile?.availabilityStatus])
  );

  async function refreshProfile(): Promise<void> {
    const { user } = await api.getMe(session.token);
    setProfile(user);
    setIsOnline(user.workerProfile?.availabilityStatus === "AVAILABLE");
  }

  async function goOnline(): Promise<void> {
    if (!profile) return;

    if (needsProfilePhoto(profile)) {
      showConfirm(
        "Profile photo required",
        "Upload a profile photo before going online.",
        () => navigation.navigate("EditProfile"),
        { confirmLabel: "Add photo", cancelLabel: "Cancel" }
      );
      return;
    }

    if (!canWorkerGoOnline(profile)) {
      showAlert(
        "Verification required",
        "Verify your email, complete your profile, and get admin approval before going online."
      );
      return;
    }

    if (!preferencesReady) {
      showConfirm(
        "Set up work preferences",
        "Choose your services and travel distance before going online.",
        () => navigation.navigate("WorkerWorkPreferences"),
        { confirmLabel: "Open preferences", cancelLabel: "Cancel" }
      );
      return;
    }

    const travelDistanceMiles = Math.min(
      MAX_WORKER_TRAVEL_MILES,
      Math.max(1, Math.round(Number(preferences.travelDistanceMiles) || 10))
    );

    setIsGoingOnline(true);
    try {
      const coords = await getCurrentCoordinates();
      const resolved = await api.reverseGeocode(coords.latitude, coords.longitude, session.token);

      const availability = workerAvailabilitySchema.safeParse({
        serviceCategoryIds: preferences.serviceCategoryIds,
        latitude: coords.latitude,
        longitude: coords.longitude,
        travelDistanceMiles,
        hourlyRateCents: Math.round((Number(preferences.hourlyRate) || 35) * 100),
        minJobAmountCents: Math.round((Number(preferences.minJobAmount) || 50) * 100)
      });

      if (!availability.success) {
        const errors = zodErrorsToFieldMap(availability.error);
        throw new Error(Object.values(errors)[0] ?? "Fix your work preferences, then try again.");
      }

      await api.updateWorkerLocation(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          formattedAddress: resolved.location.formattedAddress
        },
        session.token
      );

      await api.updateWorkerAvailability(availability.data, session.token);

      socket?.emit("worker:available", {
        serviceCategoryIds: availability.data.serviceCategoryIds,
        latitude: coords.latitude,
        longitude: coords.longitude
      });

      await refreshProfile();
      setIsOnline(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      const needsLocation =
        /location|geolocation|permission|position/i.test(message) ||
        message.toLowerCase().includes("not available");

      showAlert(
        "Could not go online",
        needsLocation
          ? `${message}\n\nAllow location access for this site, then try again.`
          : message
      );
    } finally {
      setIsGoingOnline(false);
    }
  }

  async function goOffline(): Promise<void> {
    try {
      await api.setWorkerOffline(session.token);
      socket?.emit("worker:offline");
      await refreshProfile();
      setIsOnline(false);
    } catch (error) {
      showAlert("Could not go offline", error instanceof Error ? error.message : "Try again.");
    }
  }

  return {
    isOnline,
    isGoingOnline,
    preferencesReady,
    goOnline,
    goOffline
  };
}
