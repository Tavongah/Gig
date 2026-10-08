import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole, optionalAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  browseNearbyProducts,
  browseNearbyShops,
  checkoutCart,
  getCustomerCommerceOrder,
  payCustomerEcoCash,
  getProductDetailNear,
  getShopCatalog,
  listBrowseCategories,
  listCustomerCommerceOrders,
  prepareCheckout,
  quoteCart,
  quoteTextBasket,
  type BrowseGeo
} from "./customer-commerce.service.js";
import { createGuestHandoff, publicWhatsAppDigits } from "./guest-handoff.service.js";
import { listShoppingAreas } from "./shopping-areas.js";
import { logDutsFlow } from "../../lib/flow-log.js";
import { matchSmartBasket, selectSmartBasket } from "./smart-basket.service.js";
import { parseSmartBasketEnabled, parseMultiShopCheckoutEnabled, parseMaxShopsPerCheckout, parseUnlistedItemRequestEnabled, parseUnlistedItemCodEnabled, parseProductFlavorOptionsEnabled } from "@gigflow/shared";

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
    smartBasketEnabled: parseSmartBasketEnabled(process.env.SMART_BASKET_ENABLED),
    multiShopCheckoutEnabled: parseMultiShopCheckoutEnabled(process.env.MULTI_SHOP_CHECKOUT_ENABLED),
    maxShopsPerCheckout: parseMaxShopsPerCheckout(
      process.env.MAX_SHOPS_PER_CHECKOUT ?? process.env.MULTI_SHOP_MAX_SHOPS
    ),
    unlistedItemRequestEnabled: parseUnlistedItemRequestEnabled(process.env.UNLISTED_ITEM_REQUEST_ENABLED),
    productFlavorOptionsEnabled: parseProductFlavorOptionsEnabled(process.env.PRODUCT_FLAVOR_OPTIONS_ENABLED),
    unlistedItemCodEnabled: parseUnlistedItemCodEnabled(process.env.UNLISTED_ITEM_COD_ENABLED)
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
    deliveryLabel: z.string().min(1).max(240).optional(),
    locationMode: z.enum(["GPS", "TYPED_PILOT"]).optional(),
    deliveryPrecision: z.string().max(24).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(99),
          flavorOptionId: z.string().uuid().nullable().optional(),
          flavorPreference: z.enum(["ANY", "SPECIFIC"]).nullable().optional()
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

const prepareSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  deliveryLabel: z.string().min(1).max(240).optional(),
  locationMode: z.enum(["GPS", "TYPED_PILOT"]).optional(),
  deliveryPrecision: z.string().max(24).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        flavorOptionId: z.string().uuid().nullable().optional(),
        flavorPreference: z.enum(["ANY", "SPECIFIC"]).nullable().optional()
      })
    )
    .min(1)
    .max(40)
});

customerCommerceRouter.post("/cart/prepare", validateBody(prepareSchema), async (req, res, next) => {
  try {
    res.json(await prepareCheckout(req.body));
  } catch (err) {
    next(err);
  }
});

const joinShopSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  currentMerchantIds: z.array(z.string().uuid()).max(3),
  newMerchantId: z.string().uuid()
});

customerCommerceRouter.post("/cart/can-join", validateBody(joinShopSchema), async (req, res, next) => {
  try {
    const { canJoinShop } = await import("./multi-shop-checkout.service.js");
    res.json(await canJoinShop(req.body));
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
        quantity: z.number().int().min(1).max(99),
        flavorOptionId: z.string().uuid().nullable().optional(),
        flavorPreference: z.enum(["ANY", "SPECIFIC"]).nullable().optional()
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
  locationMode: z.enum(["GPS", "TYPED_PILOT"]).optional(),
  deliveryPrecision: z.string().max(24).optional(),
  paymentMethod: z.enum(["CASH", "ECOCASH", "ONEMONEY"]).optional(),
  customerPhone: z.string().min(7).max(24).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
        flavorOptionId: z.string().uuid().nullable().optional(),
        flavorPreference: z.enum(["ANY", "SPECIFIC"]).nullable().optional()
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

customerCommerceRouter.post(
  "/orders/:id/pay/ecocash",
  ...requireCustomer,
  validateBody(z.object({ payerPhone: z.string().min(7).max(24) })),
  async (req, res, next) => {
    try {
      const result = await payCustomerEcoCash(
        req.auth!.userId,
        String(req.params.id),
        req.body.payerPhone
      );
      res.json({
        paymentStatus: "PAYMENT_PENDING",
        displayLocal: result.displayLocal
      });
    } catch (err) {
      next(err);
    }
  }
);

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
  quantity: z.number().int().min(1).max(99),
  flavorOptionId: z.string().uuid().nullable().optional(),
  flavorPreference: z.enum(["ANY", "SPECIFIC"]).nullable().optional(),
  flavorName: z.string().max(80).nullable().optional()
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

const unlistedCreateBody = z.object({
  originalRequestText: z.string().min(2).max(500),
  quantity: z.number().int().min(1).max(20).optional(),
  optionalNotes: z.string().max(400).optional(),
  optionalMaxBudgetCents: z.number().int().positive().max(50_000).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  areaId: z.string().min(1).max(80).optional(),
  deliveryLabel: z.string().min(2).max(240).optional(),
  deliveryInstructions: z.string().max(240).optional()
});

async function resolveUnlistedGeo(input: {
  lat?: number;
  lng?: number;
  areaId?: string;
  deliveryLabel?: string;
}) {
  if (input.lat != null && input.lng != null) {
    return { lat: input.lat, lng: input.lng, label: input.deliveryLabel ?? "Delivery location" };
  }
  if (input.areaId) {
    const { DUTS_CITY_SEEDS, listShoppingAreas } = await import("./shopping-areas.js");
    const seed = DUTS_CITY_SEEDS.find((s) => s.id === input.areaId);
    if (seed) return { lat: seed.lat, lng: seed.lng, label: input.deliveryLabel ?? seed.name };
    const { areas } = await listShoppingAreas();
    const area = areas.find((a) => a.id === input.areaId);
    if (area) return { lat: area.lat, lng: area.lng, label: input.deliveryLabel ?? area.name };
  }
  throw new (await import("../../lib/errors.js")).AppError(
    "Delivery location is required.",
    400,
    "LOCATION_REQUIRED"
  );
}

customerCommerceRouter.post(
  "/unlisted-requests",
  optionalAuth,
  validateBody(unlistedCreateBody), async (req, res, next) => {
  try {
    const geo = await resolveUnlistedGeo(req.body);
    const { createUnlistedItemRequest } = await import("./unlisted-item.service.js");
    const { OrderSource } = await import("@prisma/client");
    let commerceCustomerId: string | null = null;
    let customerUserId: string | null = null;
    if (req.auth?.userId) {
      const { ensureAppCommerceCustomer } = await import("./commerce-customer.service.js");
      const cc = await ensureAppCommerceCustomer(req.auth.userId);
      commerceCustomerId = cc.id;
      customerUserId = req.auth.userId;
    }
    const request = await createUnlistedItemRequest({
      originalRequestText: req.body.originalRequestText,
      quantity: req.body.quantity,
      optionalNotes: req.body.optionalNotes,
      optionalMaxBudgetCents: req.body.optionalMaxBudgetCents,
      commerceCustomerId,
      customerUserId,
      orderSource: OrderSource.WEB,
      deliveryLatitude: geo.lat,
      deliveryLongitude: geo.lng,
      deliveryLabel: geo.label,
      deliveryInstructions: req.body.deliveryInstructions ?? null
    });
    res.json({ request });
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.get("/unlisted-requests/:id", async (req, res, next) => {
  try {
    const { getUnlistedRequest } = await import("./unlisted-item.service.js");
    res.json({ request: await getUnlistedRequest(String(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

customerCommerceRouter.post(
  "/unlisted-requests/:id/approve",
  validateBody(z.object({ approvalId: z.string().min(8).max(64) })),
  async (req, res, next) => {
    try {
      const { approveUnlistedQuote } = await import("./unlisted-item.service.js");
      res.json({
        request: await approveUnlistedQuote({
          requestId: String(req.params.id),
          approvalId: req.body.approvalId,
          actorId: req.auth?.userId ?? null
        })
      });
    } catch (err) {
      next(err);
    }
  }
);

customerCommerceRouter.post(
  "/unlisted-requests/:id/decline",
  validateBody(z.object({ approvalId: z.string().min(8).max(64) })),
  async (req, res, next) => {
    try {
      const { declineUnlistedQuote } = await import("./unlisted-item.service.js");
      res.json({
        request: await declineUnlistedQuote({
          requestId: String(req.params.id),
          approvalId: req.body.approvalId,
          actorId: req.auth?.userId ?? null
        })
      });
    } catch (err) {
      next(err);
    }
  }
);

customerCommerceRouter.post(
  "/unlisted-requests/:id/pay-ecocash",
  validateBody(z.object({ payerPhone: z.string().min(7).max(24) })),
  async (req, res, next) => {
    try {
      const { initiateUnlistedEcoCashPayment } = await import("./unlisted-item-payment.js");
      const result = await initiateUnlistedEcoCashPayment({
        requestId: String(req.params.id),
        payerPhoneRaw: req.body.payerPhone
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
