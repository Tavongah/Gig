export const TRACKING_STATUSES = ["OPEN", "MATCHED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"] as const;

export const ACTIVE_CLIENT_STATUSES = ["OPEN", "MATCHED", "EN_ROUTE", "IN_PROGRESS"] as const;

export const ACTIVE_WORKER_STATUSES = ["MATCHED", "EN_ROUTE", "IN_PROGRESS"] as const;

export const HISTORY_STATUSES = ["COMPLETED", "CANCELLED", "DISPUTED"] as const;

export function statusIndex(status: string): number {
  const index = TRACKING_STATUSES.indexOf(status as (typeof TRACKING_STATUSES)[number]);
  return index === -1 ? 0 : index;
}

export function statusColor(status: string): string {
  switch (status) {
    case "OPEN":
      return "bg-amber-500";
    case "MATCHED":
      return "bg-sky-500";
    case "EN_ROUTE":
      return "bg-violet-500";
    case "IN_PROGRESS":
      return "bg-brand";
    case "COMPLETED":
      return "bg-emerald-600";
    case "CANCELLED":
      return "bg-rose-500";
    default:
      return "bg-slate-500";
  }
}

export function nextWorkerAction(status: string): { label: string; next: string } | null {
  if (status === "MATCHED") return { label: "Start heading to client", next: "EN_ROUTE" };
  if (status === "EN_ROUTE") return { label: "Start gig", next: "IN_PROGRESS" };
  if (status === "IN_PROGRESS") return { label: "Mark complete", next: "COMPLETED" };
  return null;
}
