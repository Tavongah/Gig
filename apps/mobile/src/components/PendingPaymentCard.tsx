import { Pressable, Text, View } from "react-native";
import type { GigDetail } from "../lib/api";
import { formatCents } from "../lib/format";
import { AppButton } from "./AppButton";

interface PendingPaymentCardProps {
  gig: GigDetail;
  onPay: () => void;
  payLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}

export function PendingPaymentCard({
  gig,
  onPay,
  payLabel = "Confirm & Pay Securely",
  loading = false,
  disabled = false
}: PendingPaymentCardProps) {
  return (
    <Pressable onPress={onPay} disabled={disabled || loading} className="active:opacity-95">
      <View className="overflow-hidden rounded-4xl border border-brand/20 bg-ink">
        <View className="gap-4 p-5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="gap-1">
              <Text className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Confirm booking</Text>
              <Text className="text-lg font-black text-white">{gig.title}</Text>
            </View>
            <View className="rounded-full bg-white/10 px-3 py-1">
              <Text className="text-xs font-bold text-white">Stripe</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <View className="h-8 w-11 rounded-md bg-yellow/80" />
            <Text className="flex-1 text-sm text-white/80">Payment method required at checkout</Text>
          </View>

          <View className="flex-row items-end justify-between gap-3 border-t border-white/10 pt-4">
            <View>
              <Text className="text-xs uppercase tracking-wider text-white/50">Amount due</Text>
              <Text className="text-3xl font-black text-white">{formatCents(gig.totalCents)}</Text>
            </View>
            <View className="min-w-[148px] flex-1">
              <AppButton
                label={loading ? "Loading..." : payLabel}
                onPress={onPay}
                size="md"
                loading={loading}
                disabled={disabled || loading}
              />
            </View>
          </View>

          <Text className="text-xs text-white/60">
            Pay securely to confirm your booking. The worker is paid after the gig is completed.
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
