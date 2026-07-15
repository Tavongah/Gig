import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";
import { DUTS } from "../../lib/theme";

const FAQ_ITEMS = [
  {
    question: `How ${APP_NAME} works`,
    answer:
      "Customers request help from Home, nearby workers can express interest, you choose a worker, secure payment, then track the job live until completion."
  },
  {
    question: "How to request help",
    answer:
      "Tap Request Help on Home, choose a service, add details and location, confirm the time, review the estimate, and submit."
  },
  {
    question: "Payments",
    answer:
      "Payment is secured when you confirm a worker. Cards are processed through Stripe. You can manage saved cards under Profile → Payment Methods."
  },
  {
    question: "Refunds",
    answer:
      "Refund eligibility depends on when a gig is cancelled and whether work has started. Contact Support with your gig details for help."
  },
  {
    question: "Cancellations",
    answer:
      "You can cancel from My Gigs while a request is still open or before work begins. After a worker is en route or working, contact Support."
  },
  {
    question: "Worker arrival",
    answer:
      "Track your worker in Live tracking. Status updates show when they are en route, arrived, and in progress."
  },
  {
    question: "Ratings",
    answer:
      "After a completed gig, leave a rating and short review. You can review past ratings under Profile → Ratings & Reviews."
  },
  {
    question: "Account verification",
    answer:
      "Verify your email to use the app. Additional identity checks for workers appear under Identity Verification."
  },
  {
    question: "Login problems",
    answer:
      "Use Forgot Password on the login screen, confirm your email is verified, or contact Support if you cannot get back into your account."
  }
];

export function FaqScreen() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 32 }}>
        {FAQ_ITEMS.map((item, index) => {
          const open = openIndex === index;
          return (
            <DutsCard key={item.question} className="overflow-hidden p-0">
              <Pressable
                onPress={() => setOpenIndex(open ? null : index)}
                className="min-h-[56px] flex-row items-center gap-3 px-5 py-4"
              >
                <Text className="flex-1 text-base font-black text-ink">{item.question}</Text>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={DUTS.navInactive} />
              </Pressable>
              {open ? (
                <View className="border-t border-border px-5 pb-5 pt-3">
                  <Text className="text-sm leading-5 text-muted">{item.answer}</Text>
                </View>
              ) : null}
            </DutsCard>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
