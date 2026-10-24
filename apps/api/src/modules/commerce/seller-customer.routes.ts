import { createCustomerSellerPurchaseSchema } from "@gigflow/shared";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  cancelCustomerSellerPurchase,
  createCustomerSellerPurchase,
  getCustomerPilotOffer,
  getCustomerSellerPurchase
} from "./seller-customer.service.js";

export const sellerCustomerRouter = Router();

const requireCustomer = [requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN)];

function routeId(value: string | string[] | undefined, code: string) {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) {
    throw new AppError("Not found.", 404, code);
  }
  return id;
}

sellerCustomerRouter.get("/pilot-offers/:offerId", async (req, res, next) => {
  try {
    const offer = await getCustomerPilotOffer(routeId(req.params.offerId, "PILOT_NOT_ENABLED"));
    res.json({ offer });
  } catch (error) {
    next(error);
  }
});

sellerCustomerRouter.post(
  "/pilot-purchases",
  ...requireCustomer,
  validateBody(createCustomerSellerPurchaseSchema),
  async (req, res, next) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw new AppError("Not authenticated.", 401, "UNAUTHENTICATED");
      const result = await createCustomerSellerPurchase(userId, req.body);
      res.status(201).json({ purchase: result.purchase });
    } catch (error) {
      next(error);
    }
  }
);

sellerCustomerRouter.get("/pilot-purchases/:id", ...requireCustomer, async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new AppError("Not authenticated.", 401, "UNAUTHENTICATED");
    const purchase = await getCustomerSellerPurchase(userId, routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"));
    res.json({ purchase });
  } catch (error) {
    next(error);
  }
});

sellerCustomerRouter.post("/pilot-purchases/:id/cancel", ...requireCustomer, async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) throw new AppError("Not authenticated.", 401, "UNAUTHENTICATED");
    const purchase = await cancelCustomerSellerPurchase(
      userId,
      routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND")
    );
    res.json({ purchase });
  } catch (error) {
    next(error);
  }
});
