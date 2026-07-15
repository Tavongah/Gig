import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../lib/api";
import { getCurrentCoordinates } from "../lib/location";
import { canWorkerGoOnline } from "../lib/auth";
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
    if (!profile || !canWorkerGoOnline(profile)) {
      Alert.alert(
        "Verification required",
        "Verify your email, complete your profile, and get admin approval before going online."
      );
      return;
    }

    if (!preferencesReady) {
      Alert.alert(
        "Set up work preferences",
        "Choose your services and travel distance before going online.",
        [
          { text: "Open preferences", onPress: () => navigation.navigate("WorkerWorkPreferences") },
          { text: "Cancel", style: "cancel" }
        ]
      );
      return;
    }

    setIsGoingOnline(true);
    try {
      const coords = await getCurrentCoordinates();
      const resolved = await api.reverseGeocode(coords.latitude, coords.longitude, session.token);

      await api.updateWorkerLocation(
        {
          latitude: coords.latitude,
          longitude: coords.longitude,
          formattedAddress: resolved.location.formattedAddress
        },
        session.token
      );

      await api.updateWorkerAvailability(
        {
          serviceCategoryIds: preferences.serviceCategoryIds,
          latitude: coords.latitude,
          longitude: coords.longitude,
          travelDistanceMiles: Number(preferences.travelDistanceMiles) || 10,
          hourlyRateCents: Math.round((Number(preferences.hourlyRate) || 35) * 100),
          minJobAmountCents: Math.round((Number(preferences.minJobAmount) || 50) * 100)
        },
        session.token
      );

      socket?.emit("worker:available", {
        serviceCategoryIds: preferences.serviceCategoryIds,
        latitude: coords.latitude,
        longitude: coords.longitude
      });

      await refreshProfile();
      setIsOnline(true);
    } catch (error) {
      Alert.alert("Could not go online", error instanceof Error ? error.message : "Try again.");
    } finally {
      setIsGoingOnline(false);
    }
  }

  async function goOffline(): Promise<void> {
    await api.setWorkerOffline(session.token);
    socket?.emit("worker:offline");
    await refreshProfile();
    setIsOnline(false);
  }

  return {
    isOnline,
    isGoingOnline,
    preferencesReady,
    goOnline,
    goOffline
  };
}
