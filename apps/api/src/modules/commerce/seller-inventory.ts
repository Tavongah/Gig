/**
 * Atomic seller quantity changes.
 * quantity = physical units still with the seller.
 * reservedQuantity = subset held by an open fulfillment.
 * Sellable units are quantity - reservedQuantity.
 */
import { prisma } from "../../config/prisma.js";
import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

export async function reserveOfferQuantity(db: Db, offerId: string, quantity: number) {
  return db.$executeRaw`
    UPDATE "SellerOffer"
    SET "reservedQuantity" = "reservedQuantity" + ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${offerId}
      AND "status" = 'ACTIVE'::"SellerOfferStatus"
      AND ("quantity" - "reservedQuantity") >= ${quantity}
  `;
}

export async function releaseOfferQuantity(db: Db, offerId: string, quantity: number) {
  return db.$executeRaw`
    UPDATE "SellerOffer"
    SET "reservedQuantity" = "reservedQuantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${offerId}
      AND "reservedQuantity" >= ${quantity}
  `;
}

/** Immediate foundation commit of units that are not already reserved. */
export async function commitUnreservedOfferQuantity(db: Db, offerId: string, quantity: number) {
  return db.$executeRaw`
    UPDATE "SellerOffer"
    SET "quantity" = "quantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${offerId}
      AND "status" = 'ACTIVE'::"SellerOfferStatus"
      AND ("quantity" - "reservedQuantity") >= ${quantity}
  `;
}

/** Commit units already reserved for one fulfillment. Physical quantity drops once. */
export async function commitReservedOfferQuantity(db: Db, offerId: string, quantity: number) {
  return db.$executeRaw`
    UPDATE "SellerOffer"
    SET "quantity" = "quantity" - ${quantity},
        "reservedQuantity" = "reservedQuantity" - ${quantity},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${offerId}
      AND "quantity" >= ${quantity}
      AND "reservedQuantity" >= ${quantity}
  `;
}
