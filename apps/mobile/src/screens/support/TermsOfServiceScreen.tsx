import { ScrollView, Text } from "react-native";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";
import { SUPPORT_EMAIL, formatSupportPhoneDisplay } from "../../lib/support";

export function TermsOfServiceScreen() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="gap-3 p-5">
          <Text className="text-xl font-black text-ink">Terms of Service</Text>
          <Text className="text-xs text-muted">Last updated: July 15, 2026</Text>

          <Text className="text-sm leading-5 text-muted">
            By using {APP_NAME}, you agree to these Terms. If you do not agree, do not use the app.
          </Text>

          <Text className="text-base font-black text-ink">The service</Text>
          <Text className="text-sm leading-5 text-muted">
            {APP_NAME} connects customers requesting local help with independent workers. We are a marketplace platform,
            not the employer of workers and not an emergency service.
          </Text>

          <Text className="text-base font-black text-ink">Accounts</Text>
          <Text className="text-sm leading-5 text-muted">
            You must provide accurate information, keep credentials secure, and be at least 18 to create an account (or
            the age of majority where you live). Workers may require additional review before accepting paid gigs.
          </Text>

          <Text className="text-base font-black text-ink">Bookings & payments</Text>
          <Text className="text-sm leading-5 text-muted">
            Customers authorize payment when confirming a worker. Payments are processed by Stripe. Platform fees may
            apply. Cancellations, refunds, and disputes depend on gig status and Support review.
          </Text>

          <Text className="text-base font-black text-ink">Conduct & safety</Text>
          <Text className="text-sm leading-5 text-muted">
            You agree not to harass others, misuse the platform, or request illegal work. Customers must provide safe job
            conditions. Workers are responsible for the quality and lawful performance of their work. If anyone is in
            immediate danger, call 911 — {APP_NAME} is not emergency services.
          </Text>

          <Text className="text-base font-black text-ink">Limitation of liability</Text>
          <Text className="text-sm leading-5 text-muted">
            To the fullest extent permitted by law, {APP_NAME} is not liable for indirect or consequential damages arising
            from gigs arranged through the platform. Some jurisdictions do not allow certain limitations.
          </Text>

          <Text className="text-base font-black text-ink">Termination</Text>
          <Text className="text-sm leading-5 text-muted">
            You may delete your account in the app. We may suspend or terminate accounts that violate these Terms or create
            safety risks.
          </Text>

          <Text className="text-base font-black text-ink">Contact</Text>
          <Text className="text-sm leading-5 text-muted">
            Questions: {SUPPORT_EMAIL} · {formatSupportPhoneDisplay()}
          </Text>
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
