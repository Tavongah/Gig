import { ScrollView, Text, View } from "react-native";
import { AppButton } from "../../components/AppButton";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";
import { openEmergencyCall, openSupportCall, openSupportSms } from "../../lib/support";

export function SafetyScreen() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="gap-3 p-5">
          <Text className="text-xl font-black text-ink">Emergency</Text>
          <Text className="text-sm leading-5 text-muted">
            If you or someone else is in immediate danger, call 911 immediately.
          </Text>
          <Text className="text-sm font-semibold text-ink">{APP_NAME} is not an emergency service.</Text>
          <AppButton label="Call 911" onPress={() => void openEmergencyCall()} />
          <AppButton label={`Call ${APP_NAME} Support`} variant="secondary" onPress={() => void openSupportCall()} />
          <AppButton label={`Text ${APP_NAME} Support`} variant="secondary" onPress={() => void openSupportSms()} />
        </DutsCard>

        <DutsCard className="gap-3 p-5">
          <Text className="text-base font-black text-ink">Report a concern</Text>
          <Text className="text-sm text-muted">
            Contact Support right away if you experience any of the following during a gig:
          </Text>
          {[
            "Unsafe behavior",
            "Harassment",
            "Fraud or payment scams",
            "Dangerous situations at a job location"
          ].map((item) => (
            <View key={item} className="border-b border-border py-2">
              <Text className="font-semibold text-ink">{item}</Text>
            </View>
          ))}
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
