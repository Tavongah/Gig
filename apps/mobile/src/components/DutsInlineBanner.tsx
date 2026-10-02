import { Text, View } from "react-native";
import { DUTS } from "../lib/theme";
import { LoadingButton } from "./LoadingButton";

export type DutsInlineTone = "error" | "info" | "success";

type Action = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  loading?: boolean;
};

export function DutsInlineBanner({
  title,
  body,
  tone = "error",
  actions = []
}: {
  title: string;
  body?: string;
  tone?: DutsInlineTone;
  actions?: Action[];
}) {
  const border =
    tone === "success" ? DUTS.success : tone === "info" ? DUTS.purple : DUTS.orange;
  return (
    <View
      className="gap-3 rounded-2xl border p-4"
      style={{ borderColor: border, backgroundColor: DUTS.card }}
    >
      <Text className="text-base font-black text-ink">{title}</Text>
      {body ? <Text className="text-sm text-ink">{body}</Text> : null}
      {actions.map((action) => (
        <LoadingButton
          key={action.label}
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? "secondary"}
          loading={action.loading}
        />
      ))}
    </View>
  );
}
