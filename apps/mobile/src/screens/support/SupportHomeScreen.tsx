import { Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { TabScreen } from "../../components/TabScreen";
import { APP_NAME } from "../../lib/brand";
import {
  SUPPORT_EMAIL,
  SUPPORT_HOURS_LABEL,
  SUPPORT_HOURS_NOTE,
  formatSupportPhoneDisplay,
  openSupportCall,
  openSupportEmail,
  openSupportSms
} from "../../lib/support";
import { DUTS } from "../../lib/theme";
import type { ClientTabParamList, RootStackParamList, WorkerTabParamList } from "../../navigation/types";
import { useSessionStore } from "../../stores/session.store";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<ClientTabParamList & WorkerTabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

type SupportRow = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

export function SupportHomeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const session = useSessionStore((state) => state.session)!;
  const profile = useSessionStore((state) => state.profile);
  const user = profile ?? session.user;

  const contactPayload = {
    name: user.fullName,
    accountEmail: user.email,
    phoneNumber: user.phoneNumber
  };

  const rows: SupportRow[] = [
    { icon: "call-outline", label: "Call Support", onPress: () => void openSupportCall() },
    { icon: "chatbubble-outline", label: "Text Support", onPress: () => void openSupportSms() },
    {
      icon: "mail-outline",
      label: "Email Support",
      onPress: () => void openSupportEmail(contactPayload)
    },
    {
      icon: "chatbox-ellipses-outline",
      label: "Contact Us",
      onPress: () =>
        void openSupportEmail({
          ...contactPayload,
          subject: `${APP_NAME} Contact Request`,
          issueLabel: "How can we help?"
        })
    },
    {
      icon: "bug-outline",
      label: "Report a Bug",
      onPress: () =>
        void openSupportEmail({
          ...contactPayload,
          subject: `${APP_NAME} Bug Report`,
          issueLabel: "Bug details (what happened, what you expected, device/model):"
        })
    },
    { icon: "shield-outline", label: "Safety", onPress: () => navigation.navigate("Safety") },
    {
      icon: "help-circle-outline",
      label: "Frequently Asked Questions",
      onPress: () => navigation.navigate("Faq")
    },
    {
      icon: "lock-closed-outline",
      label: "Privacy Policy",
      onPress: () => navigation.navigate("PrivacyPolicy")
    },
    {
      icon: "reader-outline",
      label: "Terms of Service",
      onPress: () => navigation.navigate("TermsOfService")
    },
    {
      icon: "information-circle-outline",
      label: `About ${APP_NAME}`,
      onPress: () => navigation.navigate("AboutDuts")
    }
  ];

  return (
    <TabScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 36, gap: 14 }}>
        <DutsCard className="gap-2 p-5">
          <Text className="text-2xl font-black text-ink">Need Help?</Text>
          <Text className="text-sm leading-5 text-muted">
            Contact the {APP_NAME} team and we&apos;ll assist you as soon as possible.
          </Text>
        </DutsCard>

        {rows.map((row) => (
          <Pressable
            key={row.label}
            onPress={row.onPress}
            accessibilityRole="button"
            accessibilityLabel={row.label}
          >
            <DutsCard className="min-h-[72px] flex-row items-center gap-4 p-5">
              <View className="h-12 w-12 items-center justify-center rounded-full bg-hero">
                <Ionicons name={row.icon} size={22} color={DUTS.purple} />
              </View>
              <Text className="flex-1 text-base font-black text-ink">{row.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={DUTS.navInactive} />
            </DutsCard>
          </Pressable>
        ))}

        <DutsCard className="gap-2 p-5">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted">Support Hours</Text>
          <Text className="text-base font-semibold text-ink">{SUPPORT_HOURS_LABEL}</Text>
          <Text className="text-sm text-muted">{SUPPORT_HOURS_NOTE}</Text>
          <Text className="mt-2 text-sm text-muted">
            {formatSupportPhoneDisplay()} · {SUPPORT_EMAIL}
          </Text>
        </DutsCard>
      </ScrollView>
    </TabScreen>
  );
}
