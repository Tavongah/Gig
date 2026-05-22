import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api, apiUrl } from "../lib/api";
import { Screen } from "../components/Screen";
import { useSessionStore } from "../stores/session.store";

function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

export function WorkerHomeScreen() {
  const session = useSessionStore((state) => state.session);
  const token = session?.token ?? "";
  const nearbyQuery = useQuery({
    queryKey: ["nearby-gigs"],
    queryFn: () => api.nearbyGigs(token),
    enabled: Boolean(token)
  });

  function connectRealtime(): void {
    const socket = io(apiUrl.replace("/v1", ""), { auth: { token } });
    socket.emit("worker:available", { serviceCategoryIds: [] });
    socket.on("gig:offer", () => {
      void nearbyQuery.refetch();
    });
  }

  return (
    <Screen>
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-sm font-bold uppercase tracking-[3px] text-brand">Worker mode</Text>
          <Text className="text-3xl font-black text-white">Nearby gigs</Text>
          <Text className="text-slate-300">Accept real-time offers, navigate to clients, complete jobs, and withdraw earnings.</Text>
        </View>

        <Pressable onPress={connectRealtime} className="rounded-2xl bg-brand px-5 py-4">
          <Text className="text-center font-black text-ink">Go available</Text>
        </Pressable>

        <View className="gap-3">
          {(nearbyQuery.data?.gigs ?? []).map((gig) => (
            <View key={gig.id} className="rounded-3xl bg-white p-5">
              <Text className="text-lg font-black text-ink">{gig.title}</Text>
              <Text className="text-slate-600">Client price {cents(gig.totalCents)}</Text>
              <Text className="font-bold text-brand">Your payout {cents(gig.workerPayoutCents)}</Text>
            </View>
          ))}
          {nearbyQuery.data?.gigs.length === 0 ? <Text className="text-center text-slate-400">No open gigs yet.</Text> : null}
        </View>
      </View>
    </Screen>
  );
}
