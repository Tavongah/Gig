import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DutsCard } from "../../components/DutsCard";
import { Screen } from "../../components/Screen";
import { DUTS } from "../../lib/theme";
import { useSessionStore } from "../../stores/session.store";

type StatusRow = {
  label: string;
  done: boolean;
  detail: string;
};

export function IdentityVerificationScreen() {
  const profile = useSessionStore((state) => state.profile);
  const session = useSessionStore((state) => state.session)!;
  const activeRole = useSessionStore((state) => state.activeRole);
  const user = profile ?? session.user;
  const roles = user.roles ?? [];
  const isWorker =
    activeRole === "WORKER" || Boolean(user.workerProfile) || roles.includes("WORKER");
  const worker = user.workerProfile;

  const customerRows: StatusRow[] = [
    {
      label: "Email Verified",
      done: Boolean(user.emailVerified),
      detail: user.emailVerified ? "Complete" : "Check your inbox to verify your email"
    },
    {
      label: "Phone Number",
      done: Boolean(user.phoneNumber),
      detail: user.phoneNumber
        ? "Saved on your profile (verification not required)"
        : "Optional — add in Personal Information"
    }
  ];

  const workerRows: StatusRow[] = [
    {
      label: "Email Verified",
      done: Boolean(user.emailVerified),
      detail: user.emailVerified ? "Complete" : "Check your inbox to verify your email"
    },
    {
      label: "Identity & Approval",
      done: Boolean(user.isVerified || user.accountStatus === "APPROVED"),
      detail:
        user.accountStatus === "APPROVED" || user.isVerified
          ? "Approved to work"
          : user.accountStatus === "PENDING_APPROVAL"
            ? "Pending Duts review"
            : user.accountStatus === "REJECTED"
              ? "Not approved — contact Support"
              : "Complete worker application for review"
    },
    {
      label: "Background Check Consent",
      done: Boolean(worker?.backgroundCheckConsent || worker?.backgroundCheckCompleted),
      detail: worker?.backgroundCheckCompleted
        ? "Completed"
        : worker?.backgroundCheckConsent
          ? "Consent on file"
          : "Required during worker signup"
    },
    {
      label: "Government ID Acknowledgment",
      done: Boolean(worker?.governmentIdAcknowledged),
      detail: worker?.governmentIdAcknowledged
        ? "Acknowledged during signup"
        : "Required during worker signup"
    }
  ];

  const rows = isWorker ? workerRows : customerRows;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 32 }}>
        <Text className="text-sm text-muted">
          {isWorker
            ? "These checks are tied to your worker application and account status."
            : "Account verification status for your Duts profile."}
        </Text>
        <DutsCard className="overflow-hidden p-2">
          {rows.map((row, index) => (
            <View
              key={row.label}
              className={`min-h-[56px] flex-row items-center gap-3 px-3 py-3 ${
                index < rows.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <Ionicons
                name={row.done ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={row.done ? DUTS.success : DUTS.navInactive}
              />
              <View className="flex-1">
                <Text className="text-base font-semibold text-ink">{row.label}</Text>
                <Text className="text-sm text-muted">{row.detail}</Text>
              </View>
            </View>
          ))}
        </DutsCard>
      </ScrollView>
    </Screen>
  );
}
