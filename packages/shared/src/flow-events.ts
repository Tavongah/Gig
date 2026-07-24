/** Development flow event names for DUTS gig lifecycle logging. */
export const DUTS_FLOW_EVENTS = [
  "REQUEST_STARTED",
  "GIG_CREATED",
  "GIG_ID_RECEIVED",
  "NAVIGATION_STARTED",
  "MATCHING_STARTED",
  "OFFER_SENT",
  "WORKER_ACCEPTED",
  "MATCHING_STOPPED",
  "TAX_CALCULATED",
  "PAYMENT_AUTHORIZED",
  "GIG_STARTED",
  "GIG_COMPLETED",
  "PAYMENT_CAPTURED",
  "WORKER_EARNINGS_CREATED",
  "REVIEW_SKIPPED",
  "REVIEW_SUBMITTED",
  "HOME_REDIRECTED"
] as const;

export type DutsFlowEvent = (typeof DUTS_FLOW_EVENTS)[number];

export type DutsFlowLogPayload = {
  event: DutsFlowEvent;
  gigId?: string;
  userId?: string;
  userRole?: string;
  platform?: "web" | "mobile" | "api";
  timestamp?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};
