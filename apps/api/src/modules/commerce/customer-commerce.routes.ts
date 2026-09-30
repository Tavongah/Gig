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
  quoteTextBasket,
  type BrowseGeo
} from "./customer-commerce.service.js";
import { createGuestHandoff, publicWhatsAppDigits } from "./guest-handoff.service.js";
import { listShoppingAreas } from "./shopping-areas.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { matchSmartBasket, selectSmartBasket } from "./smart-basket.service.js";
import { parseSmartBasketEnabled } from "@gigflow/shared";

const geoQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    areaId: z.string().min(1).max(80).optional()
  })
  .refine((value) => Boolean(value.areaId) || (value.lat != null && value.lng != null), {
    message: "areaId or lat and lng required"
  });

const optionalGeoQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    areaId: z.string().min(1).max(80).optional()
  })
  .refine(
    (value) =>
      Boolean(value.areaId) ||
      (value.lat != null && value.lng != null) ||
      (value.lat == null && value.lng == null && !value.areaId),
    { message: "areaId or both lat and lng required when providing a location" }
  );

function browseGeoFromQuery(query: z.infer<typeof geoQuery>): BrowseGeo {
  if (query.areaId) return { areaId: query.areaId };
  return { lat: query.lat!, lng: query.lng! };
}

function optionalBrowseGeoFromQuery(query: z.infer<typeof optionalGeoQuery>): BrowseGeo | undefined {
  if (query.areaId) return { areaId: query.areaId };
  if (query.lat != null && query.lng != null) return { lat: query.lat, lng: query.lng };
  return undefined;
}

export const customerCommerceRouter = Router();

const requireCustomer = [requireAuth, requireRole(UserRole.CLIENT, UserRole.ADMIN)];

customerCommerceRouter.get("/public-config", (_req, res) => {
  const digits = publicWhatsAppDigits();
  res.json({
    whatsappE164: digits ? `+${digits}` : null,
    whatsappDigits: digits,
    smartBasketEnabled: parseSmartBasketEnabled(process.env.SMART_BASKET_ENABLED)
  });
});

customerCommerceRouter.get("/shopping-areas", async (_req, res, next) => {
  try {
    res.json(await listShoppingAreas());
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/shops/nearby", async (req, res, next) => {
  try {
    const geo = browseGeoFromQuery(geoQuery.parse(req.query));
    res.json(await browseNearbyShops(geo));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/products", async (req, res, next) => {
  try {
    const geoQueryParsed = optionalGeoQuery.parse(req.query);
    const geo = optionalBrowseGeoFromQuery(geoQueryParsed);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const result = await browseNearbyProducts({ ...geo, q, category, limit, offset });
    if (!req.header("authorization")) logDutsFlow("GUEST_STOREFRONT_VIEW", { shopsNearby: result.shopsNearby });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/categories", async (req, res, next) => {
  try {
    const geo = optionalBrowseGeoFromQuery(optionalGeoQuery.parse(req.query));
    res.json(await listBrowseCategories(geo));
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/products/detail", async (req, res, next) => {
  try {
    const geo = optionalBrowseGeoFromQuery(optionalGeoQuery.parse(req.query));
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
    const geo = browseGeoFromQuery(geoQuery.parse(req.query));
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    res.json(
      await getShopCatalog({
        merchantId: String(req.params.id),
        ...geo,
        q
      })
    );
  } catch (err) {
    next(err);
  }
});

const quoteSchema = z
  .object({
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    deferDelivery: z.boolean().optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99)
        })
      )
      .min(1)
      .max(40)
  })
  .refine((value) => value.deferDelivery || (value.lat != null && value.lng != null), {
    message: "lat and lng required unless delivery is deferred"
  });

customerCommerceRouter.post("/cart/quote", validateBody(quoteSchema), async (req, res, next) => {
  try {
    res.json(await quoteCart(req.body));
  } catch (err) {
    next(err);
  }
});

const handoffSchema = z.object({
  shoppingAreaId: z.string().min(1).max(80).optional(),
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

customerCommerceRouter.post("/guest/handoff", validateBody(handoffSchema), async (req, res, next) => {
  try {
    const result = await createGuestHandoff(req.body);
    logDutsFlow("GUEST_CHECKOUT_STARTED", { channel: "whatsapp" });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const checkoutSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  deliveryLabel: z.string().min(1).max(200),
  paymentMethod: z.enum(["CASH", "ECOCASH", "ONEMONEY"]).optional(),
  customerPhone: z.string().min(7).max(24).optional(),
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

const desiredItemSchema = z.object({
  catalogProductId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99)
});

const basketMatchSchema = z
  .object({
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180)
      })
      .optional(),
    areaId: z.string().min(1).max(80).optional(),
    items: z.array(desiredItemSchema).min(1).max(40)
  })
  .refine((value) => Boolean(value.areaId) || Boolean(value.location), {
    message: "location or areaId required"
  });

const basketSelectSchema = z
  .object({
    merchantId: z.string().uuid(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180)
      })
      .optional(),
    areaId: z.string().min(1).max(80).optional(),
    deferDelivery: z.boolean().optional(),
    acceptPartial: z.boolean().optional(),
    expectedFulfilledLines: z.number().int().min(0).max(40).optional(),
    items: z.array(desiredItemSchema).min(1).max(40)
  })
  .refine((value) => Boolean(value.areaId) || Boolean(value.location), {
    message: "location or areaId required"
  });

customerCommerceRouter.post("/basket/match", validateBody(basketMatchSchema), async (req, res, next) => {
  try {
    const result = await matchSmartBasket({
      lat: req.body.location?.latitude,
      lng: req.body.location?.longitude,
      areaId: req.body.areaId,
      items: req.body.items
    });
    const top = result.matches[0];
    logDutsFlow("BASKET_MATCH_STARTED", { requestedLines: result.requestedLines });
    if (top?.complete) logDutsFlow("BASKET_MATCH_COMPLETE", { merchantId: top.merchantId });
    else if (top) logDutsFlow("BASKET_MATCH_PARTIAL", { merchantId: top.merchantId, fulfilled: top.fulfilledLineCount });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.post("/basket/select", validateBody(basketSelectSchema), async (req, res, next) => {
  try {
    const result = await selectSmartBasket({
      merchantId: req.body.merchantId,
      lat: req.body.location?.latitude,
      lng: req.body.location?.longitude,
      areaId: req.body.areaId,
      deferDelivery: req.body.deferDelivery,
      acceptPartial: req.body.acceptPartial,
      expectedFulfilledLines: req.body.expectedFulfilledLines,
      items: req.body.items
    });
    if (!result.changed && result.match) {
      logDutsFlow("BASKET_MATCH_SELECTED", { merchantId: result.match.merchantId });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
