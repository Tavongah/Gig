import { ScrollView, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "../../lib/api";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "CrossBorderTrack">;

export function CrossBorderTrackScreen({ route }: Props) {
  const track = useQuery({
    queryKey: ["cross-border-track", route.params.token],
    queryFn: () => api.crossBorderTracking(route.params.token)
  });
  const data = track.data as {
    reference?: string;
    message?: string;
    destinationCity?: string;
    lines?: Array<{ quantity: number; productName: string; size?: string | null; color?: string | null }>;
    shipment?: { trackingNumber?: string | null; shippingProvider?: string | null } | null;
  } | undefined;
  if (track.isLoading) return <Text className="p-5">Loading request</Text>;
  if (!data) return <Text className="p-5">This tracking link is not valid.</Text>;
  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 20 }}>
      <Text className="text-xl font-extrabold text-ink">DUTS {data.reference}</Text>
      <Text className="mt-3 text-base text-ink">{data.message}</Text>
      <Text className="mt-2 text-sm text-muted">Delivery city: {data.destinationCity}</Text>
      {(data.lines ?? []).map((line, index) => (
        <Text key={index} className="mt-2 text-sm text-ink">
          {line.quantity} x {line.productName}{line.size ? `, size ${line.size}` : ""}{line.color ? `, colour ${line.color}` : ""}
        </Text>
      ))}
      {data.shipment?.trackingNumber ? (
        <Text className="mt-3 text-sm text-ink">Tracking {data.shipment.trackingNumber}{data.shipment.shippingProvider ? ` via ${data.shipment.shippingProvider}` : ""}</Text>
      ) : (
        <Text className="mt-3 text-sm text-muted">Tracking is updated by DUTS staff. Live carrier tracking is not connected.</Text>
      )}
    </ScrollView>
  );
}
