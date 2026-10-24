import {
  commitSellerFulfillmentSchema,
  confirmSellerFulfillmentPaymentSchema,
  createSellerFulfillmentSchema,
  createSellerOfferSchema,
  createSellerSchema,
  sellerCommissionRateSchema,
  sellerFulfillmentAttentionSchema,
  updateSellerOfferSchema,
  updateSellerSchema
} from "@gigflow/shared";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  cancelSellerFulfillment,
  completeSellerFulfillment,
  confirmSellerCodCollection,
  confirmSellerFulfillmentPayment,
  createSellerFulfillment,
  failSellerFulfillmentPayment,
  getSellerFulfillment,
  linkSellerFulfillmentDelivery,
  listSellerFulfillments,
  markSellerFulfillmentNeedsAttention
} from "./seller-fulfillment.service.js";
import {
  commitSellerFulfillment,
  createSeller,
  createSellerOffer,
  getSeller,
  getSellerCommissionRate,
  listSellerLedger,
  listSellerOffers,
  listSellers,
  pauseSellerOffer,
  setSellerCommissionRate,
  updateSeller,
  updateSellerOffer
} from "./seller.service.js";

export const sellerAdminRouter = Router();
sellerAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

function routeId(value: string | string[] | undefined, code: string) {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) {
    throw new AppError("Not found.", 404, code);
  }
  return id;
}

sellerAdminRouter.get("/seller-commission", async (_req, res, next) => {
  try {
    const rate = await getSellerCommissionRate();
    res.json({ sellerCommissionRate: rate });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.patch("/seller-commission", validateBody(sellerCommissionRateSchema), async (req, res, next) => {
  try {
    const commission = await setSellerCommissionRate(req.body.rate);
    res.json({ commission });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.get("/sellers", async (_req, res, next) => {
  try {
    res.json({ sellers: await listSellers() });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post("/sellers", validateBody(createSellerSchema), async (req, res, next) => {
  try {
    res.status(201).json({ seller: await createSeller(req.body) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.get("/sellers/:id", async (req, res, next) => {
  try {
    res.json({ seller: await getSeller(routeId(req.params.id, "SELLER_NOT_FOUND")) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.patch("/sellers/:id", validateBody(updateSellerSchema), async (req, res, next) => {
  try {
    res.json({ seller: await updateSeller(routeId(req.params.id, "SELLER_NOT_FOUND"), req.body) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.get("/sellers/:id/offers", async (req, res, next) => {
  try {
    res.json({ offers: await listSellerOffers(routeId(req.params.id, "SELLER_NOT_FOUND")) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post("/sellers/:id/offers", validateBody(createSellerOfferSchema), async (req, res, next) => {
  try {
    res.status(201).json({
      offer: await createSellerOffer(routeId(req.params.id, "SELLER_NOT_FOUND"), req.body)
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.patch(
  "/sellers/:id/offers/:offerId",
  validateBody(updateSellerOfferSchema),
  async (req, res, next) => {
    try {
      res.json({
        offer: await updateSellerOffer(
          routeId(req.params.id, "SELLER_NOT_FOUND"),
          routeId(req.params.offerId, "SELLER_OFFER_NOT_FOUND"),
          req.body
        )
      });
    } catch (error) {
      next(error);
    }
  }
);

sellerAdminRouter.post("/sellers/:id/offers/:offerId/pause", async (req, res, next) => {
  try {
    res.json({
      offer: await pauseSellerOffer(
        routeId(req.params.id, "SELLER_NOT_FOUND"),
        routeId(req.params.offerId, "SELLER_OFFER_NOT_FOUND")
      )
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post(
  "/sellers/:id/offers/:offerId/commit-fulfillment",
  validateBody(commitSellerFulfillmentSchema),
  async (req, res, next) => {
    try {
      const result = await commitSellerFulfillment(
        routeId(req.params.id, "SELLER_NOT_FOUND"),
        routeId(req.params.offerId, "SELLER_OFFER_NOT_FOUND"),
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

sellerAdminRouter.post(
  "/sellers/:id/offers/:offerId/fulfillments",
  validateBody(createSellerFulfillmentSchema),
  async (req, res, next) => {
    try {
      const fulfillment = await createSellerFulfillment(
        routeId(req.params.id, "SELLER_NOT_FOUND"),
        routeId(req.params.offerId, "SELLER_OFFER_NOT_FOUND"),
        req.body
      );
      res.status(201).json({ fulfillment });
    } catch (error) {
      next(error);
    }
  }
);

sellerAdminRouter.get("/sellers/:id/fulfillments", async (req, res, next) => {
  try {
    res.json({ fulfillments: await listSellerFulfillments(routeId(req.params.id, "SELLER_NOT_FOUND")) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.get("/seller-fulfillments/:id", async (req, res, next) => {
  try {
    res.json({ fulfillment: await getSellerFulfillment(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND")) });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post(
  "/seller-fulfillments/:id/confirm-payment",
  validateBody(confirmSellerFulfillmentPaymentSchema),
  async (req, res, next) => {
    try {
      res.json({
        fulfillment: await confirmSellerFulfillmentPayment(
          routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"),
          req.body
        )
      });
    } catch (error) {
      next(error);
    }
  }
);

sellerAdminRouter.post("/seller-fulfillments/:id/fail-payment", async (req, res, next) => {
  try {
    res.json({
      fulfillment: await failSellerFulfillmentPayment(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"))
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post("/seller-fulfillments/:id/cancel", async (req, res, next) => {
  try {
    res.json({
      fulfillment: await cancelSellerFulfillment(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"))
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post(
  "/seller-fulfillments/:id/needs-attention",
  validateBody(sellerFulfillmentAttentionSchema),
  async (req, res, next) => {
    try {
      res.json({
        fulfillment: await markSellerFulfillmentNeedsAttention(
          routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"),
          req.body
        )
      });
    } catch (error) {
      next(error);
    }
  }
);

sellerAdminRouter.post("/seller-fulfillments/:id/link-delivery", async (req, res, next) => {
  try {
    const actingUserId = req.auth?.userId;
    if (!actingUserId) throw new AppError("Not authenticated.", 401, "UNAUTHENTICATED");
    res.status(201).json(
      await linkSellerFulfillmentDelivery(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"), actingUserId)
    );
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post("/seller-fulfillments/:id/complete", async (req, res, next) => {
  try {
    res.json({
      fulfillment: await completeSellerFulfillment(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"))
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.post("/seller-fulfillments/:id/confirm-collection", async (req, res, next) => {
  try {
    res.json({
      fulfillment: await confirmSellerCodCollection(routeId(req.params.id, "SELLER_FULFILLMENT_NOT_FOUND"))
    });
  } catch (error) {
    next(error);
  }
});

sellerAdminRouter.get("/sellers/:id/ledger", async (req, res, next) => {
  try {
    const entries = await listSellerLedger(routeId(req.params.id, "SELLER_NOT_FOUND"));
    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        commissionRate: Number(entry.commissionRate)
      }))
    });
  } catch (error) {
    next(error);
  }
});
