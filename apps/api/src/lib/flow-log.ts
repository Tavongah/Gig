import type { DutsFlowEvent } from "@gigflow/shared";

/** Temporary structured flow logs for DUTS gig lifecycle debugging. Never log secrets. */
export function logDutsFlow(
  event: DutsFlowEvent,
  fields: {
    gigId?: string;
    userId?: string;
    userRole?: string;
    platform?: "web" | "mobile" | "api";
    [key: string]: string | number | boolean | null | undefined;
  } = {}
): void {
  if (process.env.NODE_ENV === "production" && process.env.DUTS_FLOW_LOGS !== "1") {
    return;
  }
  const { gigId, userId, userRole, platform = "api", ...meta } = fields;
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      event,
      gigId: gigId ?? null,
      userId: userId ?? null,
      userRole: userRole ?? null,
      platform,
      timestamp: new Date().toISOString(),
      ...meta
    })
  );
}
