import { Linking, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { APP_NAME } from "../../lib/brand";
import { AppButton } from "../../components/AppButton";
import { useSessionStore } from "../../stores/session.store";

export function WorkerStripeConnectScreen() {
  const session = useSessionStore((state) => state.session)!;

  const connectQuery = useQuery({
    queryKey: ["stripe-connect"],
    queryFn: () => api.getConnectStatus(session.token)
  });

  const linkMutation = useMutation({
    mutationFn: () => api.createConnectAccountLink(session.token),
    onSuccess: async (result) => {
      if (result.url) {
        await Linking.openURL(result.url);
      }
    }
  });

  const connect = connectQuery.data?.connect;

  return (
    <TabScreen>
      <View className="gap-4">
        <HeroBanner
          eyebrow="Payouts"
          title="Connect Stripe"
          subtitle="Link your payout account to accept gigs and receive earnings."
        />
        <DutsCard className="gap-4 p-5">
          <Text className="text-sm text-muted">
            {APP_NAME} uses Stripe Connect. Your bank details are handled securely by Stripe — we never store them.
          </Text>
          <View className="rounded-2xl bg-surface p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-label">Status</Text>
            <Text className="mt-1 text-base font-black text-ink">
              {!connect?.accountId
                ? "Not connected"
                : connect.payoutsEnabled
                  ? "Ready for payouts"
                  : connect.detailsSubmitted
                    ? "Verification in progress"
                    : "Setup incomplete"}
            </Text>
          </View>
          <AppButton
            label={linkMutation.isPending ? "Opening Stripe..." : connect?.payoutsEnabled ? "Update payout details" : "Connect Stripe account"}
            onPress={() => linkMutation.mutate()}
            disabled={linkMutation.isPending}
          />
          {linkMutation.error ? <Text className="text-sm text-danger">{linkMutation.error.message}</Text> : null}
        </DutsCard>
      </View>
    </TabScreen>
  );
}
