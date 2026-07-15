import { ScrollView, Text } from "react-native";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { APP_NAME } from "../../lib/brand";
import { SUPPORT_EMAIL, formatSupportPhoneDisplay } from "../../lib/support";

export function PrivacyPolicyScreen() {
  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <DutsCard className="gap-3 p-5">
          <Text className="text-xl font-black text-ink">Privacy Policy</Text>
          <Text className="text-xs text-muted">Last updated: July 15, 2026</Text>

          <Text className="text-sm leading-5 text-muted">
            {APP_NAME} (“we”, “us”) provides a marketplace connecting customers who need help with local workers. This
            Privacy Policy explains what information we collect, how we use it, and your choices.
          </Text>

          <Text className="text-base font-black text-ink">Information we collect</Text>
          <Text className="text-sm leading-5 text-muted">
            Account details (name, email, optional phone), profile photo you upload, gig descriptions and job locations,
            payment information processed by Stripe (we do not store full card numbers), device/session information needed
            to keep you signed in, and messages you send in gig chat or to Support.
          </Text>

          <Text className="text-base font-black text-ink">How we use information</Text>
          <Text className="text-sm leading-5 text-muted">
            We use your information to create and secure accounts, match bookings, process payments and payouts, provide
            live tracking and messaging, prevent fraud, verify workers, and respond to support requests. We do not sell
            your personal information.
          </Text>

          <Text className="text-base font-black text-ink">Sharing</Text>
          <Text className="text-sm leading-5 text-muted">
            We share limited information with Stripe for payments, mapping/location providers to validate addresses, email
            and messaging providers when configured, and with the other party to a booking as needed to complete the gig.
            We may disclose information if required by law.
          </Text>

          <Text className="text-base font-black text-ink">Location</Text>
          <Text className="text-sm leading-5 text-muted">
            Location is used while you use the app to show nearby work and confirm arrivals. We request location only when
            needed for those features and only with your permission.
          </Text>

          <Text className="text-base font-black text-ink">Retention & deletion</Text>
          <Text className="text-sm leading-5 text-muted">
            You can delete your account in Profile → Delete Account (also available on account status screens). Deleting
            disables the account, removes profile identifiers from normal use, and signs you out. Some transaction records
            may be retained as required for payments, fraud prevention, and legal obligations.
          </Text>

          <Text className="text-base font-black text-ink">Children</Text>
          <Text className="text-sm leading-5 text-muted">
            {APP_NAME} is not directed to children under 13. Do not create an account if you are under 13.
          </Text>

          <Text className="text-base font-black text-ink">Contact</Text>
          <Text className="text-sm leading-5 text-muted">
            Privacy questions: {SUPPORT_EMAIL} · {formatSupportPhoneDisplay()}
          </Text>
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
