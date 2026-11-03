/**
 * Customer-facing DUTS delivery estimate.
 * Times are shown in Harare. The courier's name is never included.
 */

const TIME_ZONE = "Africa/Harare";

export type CustomerDeliveryEstimate = {
  start?: Date | string | null;
  end?: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateLine(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long"
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${weekday}, ${day} ${month}`;
}

function clock(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function shortDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric"
  }).format(date);
}

function shortClock(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const period = (parts.find((part) => part.type === "dayPeriod")?.value ?? "").toUpperCase();
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

export function deliveryEstimateWindow(estimate: CustomerDeliveryEstimate | null | undefined): {
  start: Date;
  end: Date | null;
} | null {
  const start = asDate(estimate?.start);
  if (!start) return null;
  const end = asDate(estimate?.end);
  return { start, end: end && end.getTime() !== start.getTime() ? end : null };
}

export function formatCustomerDeliveryEstimateLabel(
  estimate: CustomerDeliveryEstimate | null | undefined
): string | null {
  const window = deliveryEstimateWindow(estimate);
  if (!window) return null;
  const day = shortDay(window.start);
  if (!window.end) return `Estimated delivery: ${day}`;
  return `Estimated delivery: ${day}, ${shortClock(window.start)}–${shortClock(window.end)}`;
}

export function formatCustomerDeliveryEstimateMessage(
  estimate: CustomerDeliveryEstimate,
  changed: boolean
): string {
  const window = deliveryEstimateWindow(estimate);
  if (!window) return "We'll send your delivery estimate.";
  const date = dateLine(window.start);
  const times = window.end ? `${clock(window.start)} – ${clock(window.end)}` : null;
  if (!times) return `Estimated delivery: ${date}.`;
  if (changed) {
    return ["Delivery update 🚚", "", "Your estimated delivery has changed.", "", "New estimated delivery:", date, times].join(
      "\n"
    );
  }
  return ["Delivery update 🚚", "", "Estimated delivery:", date, times, "", "We'll let you know if anything changes."].join(
    "\n"
  );
}
