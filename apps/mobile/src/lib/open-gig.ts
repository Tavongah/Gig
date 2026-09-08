import type { GigDetail } from "./api";
import { isSearching, needsClientReview } from "./gig-status";
import { gigAwaitingWorkerSelection } from "./gig-payment";

type NavigateFn = {
  navigate: (name: string, params?: object) => void;
};

/** Route into DeliveryJob vs legacy LOCAL_HELP screens based on fulfillmentType. */
export function openGigForRole(
  navigation: NavigateFn,
  gig: Pick<GigDetail, "id" | "status" | "fulfillmentType" | "paymentStatus" | "payment" | "assignments">,
  role: "CLIENT" | "WORKER"
): void {
  const isDelivery = gig.fulfillmentType === "DELIVERY";

  if (isDelivery) {
    if (role === "CLIENT" && gigAwaitingWorkerSelection(gig)) {
      navigation.navigate("GigSelectWorkers", { gigId: gig.id });
      return;
    }
    if (role === "CLIENT" && needsClientReview(gig.status)) {
      navigation.navigate("GigCompletionReview", { gigId: gig.id });
      return;
    }
    if (role === "WORKER" && isSearching(gig.status)) {
      navigation.navigate("WorkerMatching", { gigId: gig.id });
      return;
    }
    navigation.navigate("DeliveryJob", { gigId: gig.id });
    return;
  }

  if (role === "CLIENT") {
    if (gigAwaitingWorkerSelection(gig)) {
      navigation.navigate("GigSelectWorkers", { gigId: gig.id });
      return;
    }
    if (needsClientReview(gig.status)) {
      navigation.navigate("GigCompletionReview", { gigId: gig.id });
      return;
    }
    navigation.navigate("GigTracking", { gigId: gig.id });
    return;
  }

  if (isSearching(gig.status)) {
    navigation.navigate("WorkerMatching", { gigId: gig.id });
    return;
  }
  navigation.navigate("GigDetail", { gigId: gig.id });
}
