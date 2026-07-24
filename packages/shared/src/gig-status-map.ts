/**
 * Canonical GigStatus values live in Prisma / gigStatuses.
 * This map documents logical DUTS journey stages for UI copy only —
 * do not invent alternate status strings in API payloads.
 */
export const DUTS_JOURNEY_LABELS = {
  DRAFT: "Draft",
  POSTED: "Searching for worker",
  SEARCHING_FOR_WORKER: "Searching for worker",
  WORKER_SELECTED: "Worker selected",
  WORKER_ASSIGNED: "Worker accepted",
  WORKER_EN_ROUTE: "Worker traveling",
  WORKER_ARRIVED: "Worker arrived",
  IN_PROGRESS: "In progress",
  WAITING_EXTRA_TIME_APPROVAL: "Extra time approval",
  WAITING_CUSTOMER_CONFIRMATION: "Confirm completion",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed"
} as const;

export type DutsJourneyStatus = keyof typeof DUTS_JOURNEY_LABELS;

export function gigStatusLabel(status: string): string {
  return DUTS_JOURNEY_LABELS[status as DutsJourneyStatus] ?? status;
}
