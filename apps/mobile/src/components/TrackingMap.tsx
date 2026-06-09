import { Image, Text, View } from "react-native";
import { haversineMiles, estimateResponseMinutes } from "@gigflow/shared";
import { DutsCard } from "./DutsCard";

interface TrackingMapProps {
  customerLat: number;
  customerLng: number;
  workerLat?: number | null;
  workerLng?: number | null;
}

function buildMapUrl(customerLat: number, customerLng: number, workerLat?: number | null, workerLng?: number | null): string {
  const centerLat = workerLat != null && workerLng != null ? (customerLat + workerLat) / 2 : customerLat;
  const centerLng = workerLat != null && workerLng != null ? (customerLng + workerLng) / 2 : customerLng;
  const markers = [`${customerLat},${customerLng},purple`];
  if (workerLat != null && workerLng != null) {
    markers.push(`${workerLat},${workerLng},orange`);
  }
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${centerLat},${centerLng}&zoom=13&size=640x320&markers=${markers.join("|")}`;
}

export function TrackingMap({ customerLat, customerLng, workerLat, workerLng }: TrackingMapProps) {
  const hasWorker = workerLat != null && workerLng != null;
  const distanceMiles = hasWorker ? haversineMiles(workerLat, workerLng, customerLat, customerLng) : null;
  const etaMinutes = distanceMiles != null ? estimateResponseMinutes(distanceMiles) : null;

  return (
    <DutsCard className="overflow-hidden">
      <Image
        source={{ uri: buildMapUrl(customerLat, customerLng, workerLat, workerLng) }}
        style={{ width: "100%", height: 220 }}
        resizeMode="cover"
      />

      <View className="flex-row justify-between px-5 py-4">
        <View>
          <Text className="text-xs font-bold uppercase text-teal">Customer</Text>
          <Text className="text-xs font-semibold text-ink">Job location</Text>
        </View>
        {hasWorker ? (
          <View className="items-end">
            <Text className="text-xs font-bold uppercase text-orange">ETA</Text>
            <Text className="font-black text-orange">{etaMinutes} min</Text>
            <Text className="text-xs text-muted">{distanceMiles?.toFixed(1)} mi away</Text>
          </View>
        ) : null}
      </View>
    </DutsCard>
  );
}
