export function formatCents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

export function formatStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatAddress(gig: { addressLine1: string; city: string; region: string }): string {
  return `${gig.addressLine1}, ${gig.city}, ${gig.region}`;
}
