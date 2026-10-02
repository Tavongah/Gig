export function friendlyCheckoutError(message: string) {
  if (/VALIDATION_ERROR|Invalid uuid|Required|INTERNAL_ERROR|Prisma|Zod/i.test(message)) {
    return "Something changed with your cart. Please review it.";
  }
  return message;
}

export function moneyLabel(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
