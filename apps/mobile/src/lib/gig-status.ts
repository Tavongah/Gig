export const TRACKING_STATUSES = [
  "SEARCHING_FOR_WORKER",
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED"
] as const;

export const ACTIVE_CLIENT_STATUSES = [
  "POSTED",
  "SEARCHING_FOR_WORKER",
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS"
] as const;

export const ACTIVE_WORKER_STATUSES = [
  "WORKER_ASSIGNED",
  "WORKER_EN_ROUTE",
  "WORKER_ARRIVED",
  "IN_PROGRESS"
] as const;

export const COMPLETED_STATUSES = ["COMPLETED"] as const;

export const CANCELLED_STATUSES = ["CANCELLED", "DISPUTED"] as const;

export const HISTORY_STATUSES = ["COMPLETED", "CANCELLED", "DISPUTED"] as const;

export const SEARCHING_STATUSES = ["POSTED", "SEARCHING_FOR_WORKER"] as const;

export function statusIndex(status: string): number {
  const index = TRACKING_STATUSES.indexOf(status as (typeof TRACKING_STATUSES)[number]);
  if (index !== -1) return index;
  if (SEARCHING_STATUSES.includes(status as (typeof SEARCHING_STATUSES)[number])) return 0;
  return 0;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "POSTED":
    case "SEARCHING_FOR_WORKER":
      return "Searching for worker";
    case "WORKER_ASSIGNED":
      return "Worker assigned";
    case "WORKER_EN_ROUTE":
      return "Worker en route";
    case "WORKER_ARRIVED":
      return "Worker arrived";
    case "IN_PROGRESS":
      return "In progress";
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "DISPUTED":
      return "Disputed";
    default:
      return status;
  }
}

export function statusHeadline(status: string): string {
  switch (status) {
    case "POSTED":
    case "SEARCHING_FOR_WORKER":
      return "Finding a worker near you...";
    case "WORKER_ASSIGNED":
      return "Worker assigned";
    case "WORKER_EN_ROUTE":
      return "Your worker is on the way";
    case "WORKER_ARRIVED":
      return "Your worker has arrived";
    case "IN_PROGRESS":
      return "Work in progress";
    case "COMPLETED":
      return "Gig completed successfully";
    case "CANCELLED":
      return "Gig cancelled";
    default:
      return statusLabel(status);
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "POSTED":
    case "SEARCHING_FOR_WORKER":
      return "bg-brand";
    case "WORKER_ASSIGNED":
      return "bg-teal";
    case "WORKER_EN_ROUTE":
      return "bg-orange";
    case "WORKER_ARRIVED":
      return "bg-success";
    case "IN_PROGRESS":
      return "bg-brand";
    case "COMPLETED":
      return "bg-success";
    case "CANCELLED":
    case "DISPUTED":
      return "bg-danger";
    default:
      return "bg-muted";
  }
}

export function nextWorkerAction(status: string): { label: string; next: string } | null {
  if (status === "WORKER_ASSIGNED") return { label: "Start travel", next: "WORKER_EN_ROUTE" };
  if (status === "WORKER_EN_ROUTE") return { label: "Arrived", next: "WORKER_ARRIVED" };
  if (status === "WORKER_ARRIVED") return { label: "Start gig", next: "IN_PROGRESS" };
  if (status === "IN_PROGRESS") return { label: "Complete gig", next: "COMPLETED" };
  return null;
}

export function canClientCancel(status: string): boolean {
  return (
    status === "POSTED" ||
    status === "SEARCHING_FOR_WORKER" ||
    status === "WORKER_ASSIGNED"
  );
}

export function isSearching(status: string): boolean {
  return SEARCHING_STATUSES.includes(status as (typeof SEARCHING_STATUSES)[number]);
}

export function showTrackingMap(status: string): boolean {
  return ["WORKER_ASSIGNED", "WORKER_EN_ROUTE", "WORKER_ARRIVED", "IN_PROGRESS"].includes(status);
}
