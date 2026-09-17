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
import { createGuestHandoff, publicWhatsAppDigits } from "./guest-handoff.service.js";
import { logDutsFlow } from "../../lib/flow-log.js";

const geoQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

export const customerCommerceRouter = Router();

const requireCustomer = [requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN)];

customerCommerceRouter.get("/public-config", (_req, res) => {
  const digits = publicWhatsAppDigits();
  res.json({
    whatsappE164: digits ? `+${digits}` : null,
    whatsappDigits: digits
  });
});

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
    const result = await browseNearbyProducts({ lat: geo.lat, lng: geo.lng, q, category, limit });
    if (!req.header("authorization")) logDutsFlow("GUEST_STOREFRONT_VIEW", { shopsNearby: result.shopsNearby });
    res.json(result);
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
    if (!req.header("authorization")) logDutsFlow("GUEST_PRODUCT_VIEW", { catalogProductId: catalogProductId ?? null });
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

const handoffSchema = quoteSchema.extend({
  deliveryLabel: z.string().min(1).max(200)
});

customerCommerceRouter.post("/guest/handoff", validateBody(handoffSchema), async (req, res, next) => {
  try {
    const result = await createGuestHandoff(req.body);
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "whatsapp" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = quoteSchema.extend({
  deliveryLabel: z.string().min(1).max(200),
  paymentMethod: z.enum(["CASH", "ECOCASH", "ONEMONEY"]).optional(),
  customerPhone: z.string().min(7).max(24).optional()
});

customerCommerceRouter.post("/cart/checkout", ...requireCustomer, validateBody(checkoutSchema), async (req, res, next) => {
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

customerCommerceRouter.get("/orders", ...requireCustomer, async (req, res, next) => {
  try {
    res.json(await listCustomerCommerceOrders(req.auth!.userId));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/orders/:id", ...requireCustomer, async (req, res, next) => {
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

customerCommerceRouter.post("/basket/quote-text", ...requireCustomer, validateBody(textBasketSchema), async (req, res, next) => {
  try {
    res.json(await quoteTextBasket(req.body));
  } catch (err) {
    next(err);
  }
});
