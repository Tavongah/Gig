/**
 * Admin-operated Seller Marketplace V1 management.
 * Customer fulfillment is not exposed here.
 */
import {
  createSellerOfferSchema,
  createSellerSchema,
  recordSellerFulfillmentSchema,
  updateSellerOfferSchema,
  updateSellerSchema
} from "@gigflow/shared";
import { UserRole } from "@prisma/client";
import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  confirmSellerSettlementPayment,
  createSeller,
  createSellerOffer,
  evaluateSellerOfferEligibility,
  getSeller,
  listSellerOffers,
  listSellers,
  pauseSellerOffer,
  recordSellerSaleFulfillment,
  sellerPickupContext,
  setSellerStatus,
  updateSeller,
  updateSellerOffer,
  voidSellerSettlement
} from "./seller.service.js";

export const sellerAdminRouter = Router();
sellerAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

sellerAdminRouter.get("/sellers", async (_req, res, next) => {
  try {
    const sellers = await listSellers();
    res.json({ sellers });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.get("/sellers/:id", async (req, res, next) => {
  try {
    const seller = await getSeller(String(req.params.id));
    res.json({
      seller,
      pickup: sellerPickupContext(seller)
    });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.post("/sellers", validateBody(createSellerSchema), async (req, res, next) => {
  try {
    const seller = await createSeller(req.body);
    res.status(201).json({ seller });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.patch("/sellers/:id", validateBody(updateSellerSchema), async (req, res, next) => {
  try {
    const seller = await updateSeller(String(req.params.id), req.body);
    res.json({ seller });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.post("/sellers/:id/activate", async (req, res, next) => {
  try {
    const seller = await setSellerStatus(String(req.params.id), "ACTIVE");
    res.json({ seller });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.post("/sellers/:id/suspend", async (req, res, next) => {
  try {
    const seller = await setSellerStatus(String(req.params.id), "SUSPENDED");
    res.json({ seller });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.get("/sellers/:id/offers", async (req, res, next) => {
  try {
    const offers = await listSellerOffers(String(req.params.id));
    res.json({ offers });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.post(
  "/sellers/:id/offers",
  validateBody(createSellerOfferSchema),
  async (req, res, next) => {
    try {
      const offer = await createSellerOffer({
        sellerId: String(req.params.id),
        ...req.body
      });
      res.status(201).json({ offer });
    } catch (e) {
      next(e);
    }
  }
);

sellerAdminRouter.patch(
  "/seller-offers/:offerId",
  validateBody(updateSellerOfferSchema),
  async (req, res, next) => {
    try {
      const offer = await updateSellerOffer(String(req.params.offerId), req.body);
      res.json({ offer });
    } catch (e) {
      next(e);
    }
  }
);

sellerAdminRouter.post("/seller-offers/:offerId/pause", async (req, res, next) => {
  try {
    const offer = await pauseSellerOffer(String(req.params.offerId));
    res.json({ offer });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.get("/seller-offers/:offerId/eligibility", async (req, res, next) => {
  try {
    const quantity = Math.max(1, Number(req.query.quantity ?? 1) || 1);
    const result = await evaluateSellerOfferEligibility(String(req.params.offerId), quantity);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/** Controlled/admin simulation of post-fulfillment inventory + settlement. */
sellerAdminRouter.post(
  "/seller-fulfillments",
  validateBody(recordSellerFulfillmentSchema),
  async (req, res, next) => {
    try {
      const result = await recordSellerSaleFulfillment(req.body);
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  }
);

sellerAdminRouter.post("/seller-settlements/:id/confirm-payment", async (req, res, next) => {
  try {
    const settlement = await confirmSellerSettlementPayment(String(req.params.id));
    res.json({ settlement });
  } catch (e) {
    next(e);
  }
});

sellerAdminRouter.post("/seller-settlements/:id/void", async (req, res, next) => {
  try {
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;
    const settlement = await voidSellerSettlement(String(req.params.id), notes);
    res.json({ settlement });
  } catch (e) {
    next(e);
  }
});
