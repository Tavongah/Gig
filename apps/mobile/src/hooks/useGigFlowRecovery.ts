import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ACTIVE_WORKER_STATUSES, isSearching } from "../lib/gig-status";
import { useSessionStore } from "../stores/session.store";

export function useWorkerFlowRecovery() {
  const session = useSessionStore((state) => state.session)!;

  const matchingQuery = useQuery({
    queryKey: ["worker-matching-list"],
    queryFn: () => api.listWorkerMatchingInterests(session.token),
    refetchInterval: 10_000
  });

  const myGigsQuery = useQuery({
    queryKey: ["my-gigs", "WORKER"],
    queryFn: () => api.myGigs(session.token, "WORKER"),
    refetchInterval: 10_000
  });

  const matchingOffers = useMemo(
    () =>
      (matchingQuery.data?.interests ?? []).filter(
        (row) =>
          row.status === "INTERESTED" ||
          (row.status === "SELECTED" && row.gig.status === "WORKER_SELECTED")
      ),
    [matchingQuery.data?.interests]
  );

  const activeGig = useMemo(
    () =>
      (myGigsQuery.data?.gigs ?? []).find((gig) =>
        ACTIVE_WORKER_STATUSES.includes(gig.status as (typeof ACTIVE_WORKER_STATUSES)[number])
      ) ?? null,
    [myGigsQuery.data?.gigs]
  );

  return { matchingOffers, activeGig, matchingQuery, myGigsQuery };
}

export function useClientFlowRecovery() {
  const session = useSessionStore((state) => state.session)!;

  const myGigsQuery = useQuery({
    queryKey: ["my-gigs", "CLIENT"],
    queryFn: () => api.myGigs(session.token, "CLIENT"),
    refetchInterval: 10_000
  });

  const searchingGig = useMemo(() => {
    const gigs = myGigsQuery.data?.gigs ?? [];
    return gigs.find((gig) => isSearching(gig.status)) ?? null;
  }, [myGigsQuery.data?.gigs]);

  const rematching = Boolean(
    searchingGig &&
      (searchingGig.paymentStatus === "PAYMENT_CAPTURED" || searchingGig.payment?.status === "CAPTURED")
  );

  return { searchingGig, rematching, myGigsQuery };
}
