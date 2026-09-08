/**
 * Canonical GigStatus values live in Prisma / gigStatuses.
 * This map documents logical DUTS journey stages for UI copy only —
 * do not invent alternate status strings in API payloads.
 */
export const DUTS_JOURNEY_LABELS = {
  DRAFT: "Draft",
  POSTED: "Searching for courier",
  SEARCHING_FOR_WORKER: "Searching for courier",
  WORKER_SELECTED: "Courier selected",
  WORKER_ASSIGNED: "Courier assigned",
  WORKER_EN_ROUTE: "Courier heading to pickup",
  WORKER_ARRIVED: "Courier at pickup",
  PACKAGE_COLLECTED: "Package collected",
  EN_ROUTE_TO_DROPOFF: "Package on the way",
  ARRIVED_AT_DROPOFF: "Courier at drop-off",
  IN_PROGRESS: "In progress",
  WAITING_EXTRA_TIME_APPROVAL: "Extra time approval",
  WAITING_CUSTOMER_CONFIRMATION: "Confirm completion",
  COMPLETED: "Delivered",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed"
} as const;

export type DutsJourneyStatus = keyof typeof DUTS_JOURNEY_LABELS;

export function gigStatusLabel(status: string): string {
  return DUTS_JOURNEY_LABELS[status as DutsJourneyStatus] ?? status;
}
