import { prisma } from "../../config/prisma.js";

export async function isCommerceLinkedGig(gigId: string): Promise<boolean> {
  const order = await prisma.commerceOrder.findFirst({
    where: { linkedDeliveryGigId: gigId },
    select: { id: true }
  });
  if (order) return true;
  const checkout = await prisma.commerceCheckout.findFirst({
    where: { linkedDeliveryGigId: gigId },
    select: { id: true }
  });
  return Boolean(checkout);
}

export async function commerceLinkedGigIdSet(gigIds: string[]): Promise<Set<string>> {
  if (gigIds.length === 0) return new Set();
  const [orders, checkouts] = await Promise.all([
    prisma.commerceOrder.findMany({
      where: { linkedDeliveryGigId: { in: gigIds } },
      select: { linkedDeliveryGigId: true }
    }),
    prisma.commerceCheckout.findMany({
      where: { linkedDeliveryGigId: { in: gigIds } },
      select: { linkedDeliveryGigId: true }
    })
  ]);
  const ids = new Set<string>();
  for (const row of orders) {
    if (row.linkedDeliveryGigId) ids.add(row.linkedDeliveryGigId);
  }
  for (const row of checkouts) {
    if (row.linkedDeliveryGigId) ids.add(row.linkedDeliveryGigId);
  }
  return ids;
}
