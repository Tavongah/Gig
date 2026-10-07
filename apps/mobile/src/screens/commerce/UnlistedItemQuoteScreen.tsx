import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton } from "../../components/AppButton";
import { DutsInlineBanner } from "../../components/DutsInlineBanner";
import { StoreHeader, StorePage } from "../../components/StoreHeader";
import { api } from "../../lib/api";
import { DUTS } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type Props = NativeStackScreenProps<RootStackParamList, "UnlistedItemQuote">;

export function UnlistedItemQuoteScreen({ route, navigation }: Props) {
  const session = useSessionStore((s) => s.session);
  const token = session?.token;
  const { requestId, approvalId } = route.params;
  const [phone, setPhone] = useState(session?.user.phoneNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  const query = useQuery({
    queryKey: ["unlisted-request", requestId],
    queryFn: () => api.getUnlistedRequest(requestId, token),
    refetchInterval: 8_000
  });
  const request = query.data?.request;

  const approve = useMutation({
    mutationFn: () => api.approveUnlistedQuote(requestId, approvalId, token),
    onError: (err: Error) => setError(err.message)
  });
  const decline = useMutation({
    mutationFn: () => api.declineUnlistedQuote(requestId, approvalId, token),
    onSuccess: () => navigation.goBack(),
    onError: (err: Error) => setError(err.message)
  });
  const pay = useMutation({
    mutationFn: () => api.payUnlistedEcoCash(requestId, phone, token),
    onSuccess: () => setPaid(true),
    onError: (err: Error) => setError(err.message)
  });

  const approved =
    request?.status === "CUSTOMER_APPROVED" ||
    request?.status === "PAYMENT_PENDING" ||
    request?.status === "PAID" ||
    approve.isSuccess;

  return (
    <View className="flex-1 bg-background">
      <StoreHeader compact />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <StorePage>
          <Text className="mt-4 text-xl font-black text-ink">We found it</Text>
          {error ? <View className="mt-3"><DutsInlineBanner title="Couldn't continue" body={error} /></View> : null}
          {request ? (
            <View className="mt-4 gap-2">
              <Text className="text-lg font-bold text-ink">{request.foundProductName ?? request.parsedItemName}</Text>
              <Text className="text-sm text-ink">Item ${((request.foundPriceCents ?? 0) / 100).toFixed(2)}</Text>
              <Text className="text-sm text-ink">Delivery ${((request.deliveryFeeCents ?? 0) / 100).toFixed(2)}</Text>
              <Text className="text-base font-black text-ink">Total ${((request.totalCents ?? 0) / 100).toFixed(2)}</Text>
              {request.foundMerchantName ? (
                <Text className="text-sm text-muted">Found at {request.foundMerchantName}</Text>
              ) : null}
            </View>
          ) : null}

          {paid || request?.status === "PAID" ? (
            <View className="mt-6">
              <DutsInlineBanner
                tone="success"
                title="Payment confirmed"
                body="A courier is authorized to buy this item at the quoted price."
              />
            </View>
          ) : approved ? (
            <View className="mt-6 gap-3">
              <Text className="text-sm text-muted">
                Cash on delivery is not available for unlisted items. Pay with EcoCash first so the courier does not use personal money.
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="EcoCash number"
                className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-ink"
                placeholderTextColor={DUTS.placeholder}
              />
              <AppButton label="Pay with EcoCash" loading={pay.isPending} onPress={() => pay.mutate()} />
            </View>
          ) : (
            <View className="mt-6 gap-3">
              <AppButton label="Buy it" loading={approve.isPending} onPress={() => approve.mutate()} />
              <AppButton label="No thanks" variant="secondary" loading={decline.isPending} onPress={() => decline.mutate()} />
            </View>
          )}
        </StorePage>
      </ScrollView>
    </View>
  );
}
