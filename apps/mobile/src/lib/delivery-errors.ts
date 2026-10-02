/** Map delivery API error codes to customer/courier-friendly copy. */

const DELIVERY_ERROR_MESSAGES: Record<string, string> = {
  DELIVERY_DISTANCE_EXCEEDED:
    "That delivery is outside our current service area. Try a closer drop-off or split the trip.",
  INVALID_PICKUP_PIN: "That pickup code is incorrect. Ask the sender for the current code.",
  INVALID_DELIVERY_PIN: "That delivery code is incorrect. Ask the recipient for the current code.",
  PICKUP_PIN_LOCKED:
    "Too many incorrect attempts. Pickup verification is temporarily locked. Ask the customer to regenerate the codes or contact support.",
  DELIVERY_PIN_LOCKED:
    "Too many incorrect attempts. Delivery verification is temporarily locked. Ask the customer to regenerate the codes or contact support.",
  DELIVERY_CANCEL_AFTER_PICKUP:
    "This delivery can’t be cancelled after the package was collected. Contact support if you need help.",
  USE_DELIVERY_ENDPOINTS: "Use the delivery actions on this screen to continue.",
  NOT_A_DELIVERY: "This action is only for deliveries.",
  COURIER_NOT_ASSIGNED: "Only the assigned courier can continue this delivery.",
  INVALID_STATUS_TRANSITION: "This delivery updated. Check the next step.",
  RELEASE_FAILED: "We couldn't update this delivery. Please try again.",
  INVALID_TRANSPORT_MODE: "Choose Walking, Bicycle, or Public Transport / Kombi.",
  PIN_REGEN_NOT_ALLOWED: "Codes can’t be regenerated for this delivery anymore.",
  GPS_REQUIRED: "We couldn't confirm your location. Make sure location is enabled and try again.",
  GPS_VERIFICATION_FAILED: "You're still too far from the pickup location. Move closer and try again.",
  GPS_TOO_FAR: "You're still too far from the pickup location. Move closer and try again.",
  GPS_ARRIVAL_UNCERTAIN: "We couldn't confirm you're at the location. If you are there, tap I'm at the shop.",
  PAYMENT_REQUIRED: "Payment must be completed before the courier can start.",
  CANCEL_NOT_ALLOWED: "This delivery can no longer be cancelled.",
  VALIDATION_ERROR: "Check the form and try again.",
  NETWORK: "Unable to reach DUTS right now. Check your connection and try again."
};

export function friendlyDeliveryError(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code && DELIVERY_ERROR_MESSAGES[code]) return DELIVERY_ERROR_MESSAGES[code]!;
  if (error instanceof Error) {
    const mapped = DELIVERY_ERROR_MESSAGES[error.message];
    if (mapped) return mapped;
    for (const key of Object.keys(DELIVERY_ERROR_MESSAGES)) {
      if (error.message.includes(key)) return DELIVERY_ERROR_MESSAGES[key]!;
    }
    if (/network|fetch failed|Failed to fetch|timeout/i.test(error.message)) {
      return DELIVERY_ERROR_MESSAGES.NETWORK!;
    }
    if (error.message.length <= 160 && !/at\s+\w+|Exception|prisma/i.test(error.message)) {
      return error.message;
    }
  }
  return "Something went wrong. Please try again.";
}

export { DELIVERY_ERROR_MESSAGES };
