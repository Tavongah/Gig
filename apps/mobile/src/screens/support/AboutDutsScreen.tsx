import Constants from "expo-constants";
import { ScrollView, Text } from "react-native";
import { BrandLogo } from "../../components/BrandLogo";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";

export function AboutDutsScreen() {
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const year = new Date().getFullYear();

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="items-center gap-4 p-6">
          <BrandLogo size={88} />
          <Text className="text-2xl font-black text-ink">{APP_NAME}</Text>
          <Text className="text-sm font-semibold text-muted">Version {version}</Text>
          <Text className="text-center text-sm leading-5 text-muted">
            {APP_NAME} helps you book trusted local help in minutes — verified workers, secure payments, and live
            tracking for every gig.
          </Text>
          <Text className="text-xs text-muted">© {year} {APP_NAME}. All rights reserved.</Text>
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
