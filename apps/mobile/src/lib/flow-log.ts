import type { DutsFlowEvent } from "@gigflow/shared";

/** Dev flow logs for Request Help → completion. Never log secrets. */
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
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  const { gigId, userId, userRole, platform = "mobile", ...meta } = fields;
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
