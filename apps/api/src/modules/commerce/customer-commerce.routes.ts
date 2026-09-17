import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  browseNearbyProducts,
  browseNearbyShops,
  checkoutCart,
  getCustomerCommerceOrder,
  getProductDetailNear,
  getShopCatalog,
  listBrowseCategories,
  listCustomerCommerceOrders,
  quoteCart,
  quoteTextBasket
} from "./customer-commerce.service.js";

const geoQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

export const customerCommerceRouter = Router();
customerCommerceRouter.use(requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN));

customerCommerceRouter.get("/shops/nearby", async (req, res, next) => {
  try {
    const geo = geoQuery.parse(req.query);
    res.json(await browseNearbyShops(geo.lat, geo.lng));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/products", async (req, res, next) => {
  try {
    const geo = geoQuery.parse(req.query);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    res.json(await browseNearbyProducts({ lat: geo.lat, lng: geo.lng, q, category, limit }));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/categories", async (req, res, next) => {
  try {
    const geo = geoQuery.parse(req.query);
    res.json(await listBrowseCategories(geo.lat, geo.lng));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/products/detail", async (req, res, next) => {
  try {
    const geo = geoQuery.parse(req.query);
    const catalogProductId =
      typeof req.query.catalogProductId === "string" ? req.query.catalogProductId : undefined;
    const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
    if (!catalogProductId && !productId) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "catalogProductId or productId required" });
      return;
    }
    res.json(await getProductDetailNear({ ...geo, catalogProductId, productId }));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/shops/:id", async (req, res, next) => {
  try {
    const geo = geoQuery.parse(req.query);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json(
      await getShopCatalog({
        merchantId: String(req.params.id),
        lat: geo.lat,
        lng: geo.lng,
        q
      })
    );
  } catch (err) {
    next(err);
  }
});

const quoteSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99)
      })
    )
    .min(1)
    .max(40)
});

customerCommerceRouter.post("/cart/quote", validateBody(quoteSchema), async (req, res, next) => {
  try {
    res.json(await quoteCart(req.body));
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = quoteSchema.extend({
  deliveryLabel: z.string().min(1).max(200),
  paymentMethod: z.enum(["CASH", "ECOCASH", "ONEMONEY"]).optional(),
  customerPhone: z.string().min(7).max(24).optional()
});

customerCommerceRouter.post("/cart/checkout", validateBody(checkoutSchema), async (req, res, next) => {
  try {
    res.status(201).json(
      await checkoutCart({
        userId: req.auth!.userId,
        ...req.body
      })
    );
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/orders", async (req, res, next) => {
  try {
    res.json(await listCustomerCommerceOrders(req.auth!.userId));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/orders/:id", async (req, res, next) => {
  try {
    res.json(await getCustomerCommerceOrder(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const textBasketSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  items: z
    .array(
      z.object({
        query: z.string().min(1).max(120),
        quantity: z.number().int().min(1).max(99)
      })
    )
    .min(1)
    .max(20),
  preferredMerchantId: z.string().uuid().optional()
});

customerCommerceRouter.post("/basket/quote-text", validateBody(textBasketSchema), async (req, res, next) => {
  try {
    res.json(await quoteTextBasket(req.body));
  } catch (err) {
    next(err);
  }
});
