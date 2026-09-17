import {
  createCatalogProductSchema,
  linkMerchantOfferSchema,
  searchCatalogProductsSchema,
  submitMerchantCatalogProductSchema,
  updateCatalogProductSchema
} from "@gigflow/shared";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { isSpacesConfigured, uploadPublicObject } from "../../lib/spaces.js";
import { AppError } from "../../lib/errors.js";
import {
  createCatalogProduct,
  getCatalogProduct,
  linkCatalogProductToMerchant,
  migrateExistingProductsToCatalog,
  searchCatalogProducts,
  setCatalogProductStatus,
  submitMerchantNewCatalogProduct,
  updateCatalogProduct,
  findSimilarCatalogProducts
} from "./catalog.service.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const catalogAdminRouter = Router();
catalogAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

catalogAdminRouter.get("/catalog/products", async (req, res, next) => {
  try {
    const result = await searchCatalogProducts({
      q: typeof req.query.q === "string" ? req.query.q : "",
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      adminList: !req.query.status,
      limit: req.query.limit ? Number(req.query.limit) : 50
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.get("/catalog/products/:id", async (req, res, next) => {
  try {
    const result = await getCatalogProduct(String(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post(
  "/catalog/products",
  validateBody(createCatalogProductSchema),
  async (req, res, next) => {
    try {
      const product = await createCatalogProduct(req.body, { actorUserId: req.auth!.userId });
      res.status(201).json({ product });
    } catch (err) {
      next(err);
    }
  }
);

catalogAdminRouter.patch(
  "/catalog/products/:id",
  validateBody(updateCatalogProductSchema),
  async (req, res, next) => {
    try {
      const product = await updateCatalogProduct(String(req.params.id), req.body, {
        actorUserId: req.auth!.userId
      });
      res.json({ product });
    } catch (err) {
      next(err);
    }
  }
);

catalogAdminRouter.post("/catalog/products/:id/approve", async (req, res, next) => {
  try {
    const product = await setCatalogProductStatus(String(req.params.id), "APPROVED", req.auth!.userId);
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/products/:id/reject", async (req, res, next) => {
  try {
    const product = await setCatalogProductStatus(String(req.params.id), "REJECTED", req.auth!.userId);
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/products/:id/archive", async (req, res, next) => {
  try {
    const product = await setCatalogProductStatus(String(req.params.id), "ARCHIVED", req.auth!.userId);
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/products/similar", async (req, res, next) => {
  try {
    const result = await findSimilarCatalogProducts(req.body ?? {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/migrate-existing", async (_req, res, next) => {
  try {
    const report = await migrateExistingProductsToCatalog();
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/upload-image", async (req, res, next) => {
  try {
    if (!isSpacesConfigured()) {
      throw new AppError("Image storage is not configured.", 503, "STORAGE_NOT_CONFIGURED");
    }
    const { fileName, contentType, dataBase64 } = req.body as {
      fileName?: string;
      contentType?: string;
      dataBase64?: string;
    };
    if (!fileName || !contentType || !dataBase64) {
      throw new AppError("fileName, contentType, and dataBase64 are required.", 400, "VALIDATION_ERROR");
    }
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new AppError("Only JPEG, PNG, WebP, or GIF images are allowed.", 400, "INVALID_IMAGE_TYPE");
    }
    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new AppError("Image must be between 1 byte and 5MB.", 400, "INVALID_IMAGE_SIZE");
    }
    const head = buffer.subarray(0, 16).toString("utf8").toLowerCase();
    if (head.includes("<script") || head.includes("<?php") || head.includes("<html")) {
      throw new AppError("File content is not a valid image.", 400, "INVALID_IMAGE_CONTENT");
    }

    const uploaded = await uploadPublicObject({
      purpose: "product-image",
      userId: req.auth!.userId,
      fileName: fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80),
      contentType,
      body: buffer
    });
    res.status(201).json({ url: uploaded.publicUrl, objectKey: uploaded.objectKey });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.get("/merchants/:id/catalog/search", async (req, res, next) => {
  try {
    const parsed = searchCatalogProductsSchema.parse({
      q: typeof req.query.q === "string" ? req.query.q : "",
      includePendingForMerchantId: String(req.params.id),
      limit: req.query.limit ? Number(req.query.limit) : 30
    });
    const result = await searchCatalogProducts(parsed);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post(
  "/merchants/:id/catalog/link",
  validateBody(linkMerchantOfferSchema),
  async (req, res, next) => {
    try {
      const product = await linkCatalogProductToMerchant(String(req.params.id), req.body);
      res.status(201).json({ product });
    } catch (err) {
      next(err);
    }
  }
);

catalogAdminRouter.post(
  "/merchants/:id/catalog/submit",
  validateBody(submitMerchantCatalogProductSchema),
  async (req, res, next) => {
    try {
      const result = await submitMerchantNewCatalogProduct(String(req.params.id), req.body);
      res.status(result.requiresConfirmation ? 200 : 201).json(result);
    } catch (err) {
      next(err);
    }
  }
);
