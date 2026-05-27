import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { api } from "../../lib/api";
import { formatAddress, formatCents, formatStatus } from "../../lib/format";
import { nextWorkerAction, statusColor } from "../../lib/gig-status";
import { StatusTimeline } from "../../components/StatusTimeline";
import { useSocket, useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

export function GigDetailScreen() {
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const route = useRoute<RouteProp<RootStackParamList, "GigDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [workerLocation, setWorkerLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const gigQuery = useQuery({
    queryKey: ["gig", route.params.gigId],
    queryFn: () => api.getGig(route.params.gigId, session.token),
    refetchInterval: 10_000
  });

  const gig = gigQuery.data?.gig;
  const worker = gig?.assignments?.[0]?.worker;
  const workerAction = gig ? nextWorkerAction(gig.status) : null;

  const socket = useSocket();

  const invalidate = useCallback(() => {
    void gigQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
  }, [gigQuery, queryClient]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    socket.emit("gig:join", { gigId: route.params.gigId });
  }, [socket, route.params.gigId]);

  const socketEvents = useMemo(
    () => ({
      "gig:matched": invalidate,
      "gig:status": invalidate,
      "location:updated": (payload: { latitude: number; longitude: number }) => {
        setWorkerLocation({ latitude: payload.latitude, longitude: payload.longitude });
      }
    }),
    [invalidate]
  );

  useSocketEvents(socketEvents);

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.updateGigStatus(route.params.gigId, status, session.token),
    onSuccess: (_data, status) => {
      invalidate();
      if (status === "EN_ROUTE" && socket) {
        socket.emit("location:update", {
          gigId: route.params.gigId,
          latitude: 33.751,
          longitude: -84.39
        });
      }
    },
    onError: (error: Error) => Alert.alert("Update failed", error.message)
  });

  if (!gig) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <Text className="text-white">{gigQuery.isLoading ? "Loading gig..." : "Gig not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-2">
          <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">{gig.serviceCategory?.name ?? "Gig"}</Text>
          <Text className="text-3xl font-black text-white">{gig.title}</Text>
        </View>
        <View className={`rounded-full px-3 py-1 ${statusColor(gig.status)}`}>
          <Text className="text-xs font-bold text-white">{formatStatus(gig.status)}</Text>
        </View>
      </View>

      <StatusTimeline status={gig.status} />

      <View className="gap-3 rounded-3xl bg-white p-5">
        <Text className="text-lg font-black text-ink">{formatCents(gig.totalCents)}</Text>
        <Text className="text-slate-600">{gig.description}</Text>
        <Text className="text-slate-500">{formatAddress(gig)}</Text>
      </View>

      {worker ? (
        <View className="gap-2 rounded-3xl bg-slate-900 p-5">
          <Text className="text-sm font-bold uppercase tracking-wider text-brand">Your worker</Text>
          <Text className="text-2xl font-black text-white">{worker.fullName}</Text>
          {worker.phoneNumber ? <Text className="text-slate-400">{worker.phoneNumber}</Text> : null}
        </View>
      ) : activeRole === "CLIENT" ? (
        <View className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-5">
          <Text className="text-center text-slate-300">Broadcasting to nearby workers...</Text>
        </View>
      ) : null}

      {workerLocation ? (
        <View className="rounded-3xl bg-brand/15 p-5">
          <Text className="font-bold text-brand">Worker location updated</Text>
          <Text className="text-slate-300">
            {workerLocation.latitude.toFixed(4)}, {workerLocation.longitude.toFixed(4)}
          </Text>
        </View>
      ) : null}

      <View className="gap-3">
        <Pressable
          onPress={() => navigation.navigate("Chat", { gigId: gig.id, title: gig.title })}
          className="rounded-2xl bg-white px-5 py-4"
        >
          <Text className="text-center font-black text-ink">Message {activeRole === "CLIENT" ? "worker" : "client"}</Text>
        </Pressable>

        {activeRole === "WORKER" && workerAction ? (
          <Pressable
            disabled={statusMutation.isPending}
            onPress={() => statusMutation.mutate(workerAction.next)}
            className="rounded-2xl bg-brand px-5 py-4"
          >
            <Text className="text-center font-black text-ink">{workerAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
