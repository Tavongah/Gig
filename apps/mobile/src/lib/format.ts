export function formatCents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

import { statusLabel } from "./gig-status";

export function formatStatus(status: string): string {
  return statusLabel(status);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatAddress(gig: { addressLine1: string; city: string; region: string }): string {
  return `${gig.addressLine1}, ${gig.city}, ${gig.region}`;
}
