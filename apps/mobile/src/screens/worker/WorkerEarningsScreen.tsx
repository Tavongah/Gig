import { ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import { formatCents } from "../../lib/format";
import { showAlert, showConfirm } from "../../lib/confirm";
import { TabScreen } from "../../components/TabScreen";
import { HeroBanner } from "../../components/HeroBanner";
import { DutsCard } from "../../components/DutsCard";
import { EmptyState } from "../../components/EmptyState";
import { AppButton } from "../../components/AppButton";
import { useSessionStore } from "../../stores/session.store";
import { useSocketEvents } from "../../hooks/useSocket";
import type { RootStackParamList } from "../../navigation/types";

function transactionTone(type: string, status: string): string {
  if (status === "FAILED") return "text-orange";
  if (type === "GIG_COMPLETED_CREDIT") return "text-success";
  if (type.startsWith("WITHDRAWAL")) return "text-brand";
  return "text-ink";
}

export function WorkerEarningsScreen() {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();

  const invalidateEarnings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["worker-earnings"] });
  }, [queryClient]);

  const earningsQuery = useQuery({
    queryKey: ["worker-earnings"],
    queryFn: () => api.getWorkerEarnings(session.token)
  });

  useSocketEvents(useMemo(() => ({ "worker:earnings_updated": invalidateEarnings }), [invalidateEarnings]));

  const withdrawMutation = useMutation({
    mutationFn: () => api.withdrawWorkerEarnings(session.token),
    onSuccess: (result) => {
      invalidateEarnings();
      showAlert("Withdrawal sent", `${formatCents(result.amountCents)} is on its way to your bank.`);
    },
    onError: (error: Error & { code?: string }) => {
      if (error.code === "STRIPE_CONNECT_REQUIRED") {
        showConfirm(
          "Stripe setup required",
          "Connect your Stripe account before withdrawing earnings.",
          () => navigation.navigate("WorkerStripeConnect")
        );
        return;
      }

      showAlert("Withdrawal failed", error.message);
      invalidateEarnings();
    }
  });

  const earnings = earningsQuery.data?.earnings;
  const canWithdraw = (earnings?.availableBalanceCents ?? 0) > 0 && !withdrawMutation.isPending;

  const handleWithdraw = () => {
    const amount = earnings?.availableBalanceCents ?? 0;
    if (amount <= 0) return;

    if (!earnings?.stripeConnect?.payoutsEnabled) {
      showConfirm(
        "Connect Stripe to withdraw",
        "Finish Stripe payout setup, then cash out your available balance.",
        () => navigation.navigate("WorkerStripeConnect")
      );
      return;
    }

    showConfirm(
      "Withdraw earnings",
      `Transfer ${formatCents(amount)} to your connected bank account?`,
      () => withdrawMutation.mutate(),
      { confirmLabel: "Withdraw" }
    );
  };

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, gap: 16 }}>
        <HeroBanner
          eyebrow="Earnings"
          title="Your earnings"
          subtitle="Gig payouts stay in your balance until you withdraw."
        />

        <DutsCard className="gap-4 p-5">
          <View className="gap-1">
            <Text className="text-sm text-muted">Available balance</Text>
            <Text className="text-3xl font-black text-ink">{formatCents(earnings?.availableBalanceCents ?? 0)}</Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-xs text-muted">Total earned</Text>
              <Text className="text-lg font-black text-ink">{formatCents(earnings?.totalEarningsCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-xs text-muted">Withdrawn</Text>
              <Text className="text-lg font-black text-ink">{formatCents(earnings?.withdrawnBalanceCents ?? 0)}</Text>
            </View>
            <View className="flex-1 rounded-2xl bg-surface p-3">
              <Text className="text-xs text-muted">Pending gigs</Text>
              <Text className="text-lg font-black text-orange">{formatCents(earnings?.pendingEarningsCents ?? 0)}</Text>
            </View>
          </View>
          <View className="rounded-2xl bg-surface px-4 py-3">
            <Text className="text-sm font-semibold text-muted">Payout status</Text>
            <Text className="text-base text-ink">{earnings?.payoutStatus ?? "Earnings credit after gig completion"}</Text>
          </View>
          <AppButton
            label={withdrawMutation.isPending ? "Processing..." : "Withdraw to bank"}
            onPress={handleWithdraw}
            disabled={!canWithdraw}
          />
          {!earnings?.stripeConnect?.payoutsEnabled ? (
            <AppButton
              label="Set up Stripe payouts"
              variant="secondary"
              onPress={() => navigation.navigate("WorkerStripeConnect")}
            />
          ) : null}
        </DutsCard>

        <Text className="text-sm font-bold uppercase tracking-wider text-muted">Transaction history</Text>
        {(earnings?.transactions ?? []).length === 0 ? (
          <EmptyState
            emoji="💰"
            title="No transactions yet"
            description="Complete gigs to earn credits, then withdraw when you're ready."
          />
        ) : (
          <View className="gap-3">
            {(earnings?.transactions ?? []).map((transaction) => (
              <View key={transaction.id} className="rounded-3xl bg-card p-4">
                <Text className="font-black text-ink">{transaction.label}</Text>
                {transaction.gigTitle ? <Text className="text-sm text-muted">{transaction.gigTitle}</Text> : null}
                <Text className={`font-bold ${transactionTone(transaction.type, transaction.status)}`}>
                  {transaction.type.startsWith("WITHDRAWAL") ? "-" : "+"}
                  {formatCents(transaction.amountCents)}
                </Text>
                <Text className="text-xs text-muted">
                  {transaction.status.toLowerCase()} · {new Date(transaction.createdAt).toLocaleString()}
                </Text>
                {transaction.failureReason ? (
                  <Text className="text-xs text-orange">{transaction.failureReason}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
