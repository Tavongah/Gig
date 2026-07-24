import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type GigDetail } from "../lib/api";
import {
  canClientCancel,
  clientCancelConfirmMessage,
  clientCancelMayIncurFee
} from "../lib/gig-status";
import { showAlert, showConfirm } from "../lib/confirm";
import { useSessionStore } from "../stores/session.store";
import type { RootStackParamList } from "../navigation/types";
import { LoadingButton } from "./LoadingButton";

type Props = {
  gig: Pick<
    GigDetail,
    "id" | "status" | "cancellationGraceEndsAt" | "cancellationFeeCents"
  >;
  /** Optional label override */
  label?: string;
};

/**
 * Client cancel control for the booking journey.
 * Visible whenever policy allows (through Start Travel + grace/fee rules).
 */
export function ClientCancelBookingButton({ gig, label = "Cancel booking" }: Props) {
  const session = useSessionStore((state) => state.session)!;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelGig(gig.id, session.token),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["gig", gig.id] });
      void queryClient.invalidateQueries({ queryKey: ["my-gigs"] });
      const fee = result.gig.cancellationFeeCents ?? 0;
      showAlert(
        "Booking cancelled",
        fee > 0
          ? "You cancelled after the 5-minute grace period. A cancellation fee has been charged."
          : "Your booking was cancelled."
      );
      navigation.reset({ index: 0, routes: [{ name: "MainTabs" }] });
    },
    onError: (error: Error) => showAlert("Could not cancel", error.message)
  });

  if (!canClientCancel(gig.status)) {
    return null;
  }

  return (
    <LoadingButton
      label={label}
      variant="cancel"
      loading={cancelMutation.isPending}
      onPress={() =>
        showConfirm(
          clientCancelMayIncurFee(gig) ? "Cancel with fee?" : "Cancel booking?",
          clientCancelConfirmMessage(gig),
          () => cancelMutation.mutate(),
          { confirmLabel: "Cancel booking", destructive: true }
        )
      }
    />
  );
}
