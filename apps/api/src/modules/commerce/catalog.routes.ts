import {
  ADMIN_CATALOG_LIST_LIMIT,
  MERCHANT_CATALOG_SEARCH_LIMIT_MAX,
  assignCatalogImageAcquisitionSchema,
  createCatalogProductSchema,
  linkMerchantOfferSchema,
  listCatalogImageQueueSchema,
  rejectCatalogImageAcquisitionSchema,
  searchCatalogProductsSchema,
  submitMerchantCatalogProductSchema,
  updateCatalogProductSchema
} from "@gigflow/shared";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { persistNormalizedCatalogPhoto } from "../../lib/catalog-photo-upload.js";
import {
  assignValidatedAcquisition,
  listImageQueue,
  rejectAcquisitionPhoto,
  uploadAcquisitionCandidate
} from "./catalog-image-acquisition.service.js";
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

export const catalogAdminRouter = Router();
catalogAdminRouter.use(requireAuth, requireRole(UserRole.ADMIN));

catalogAdminRouter.get("/catalog/products", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const view = typeof req.query.view === "string" ? req.query.view : undefined;
    const result = await searchCatalogProducts({
      q: typeof req.query.q === "string" ? req.query.q : "",
      status,
      category: typeof req.query.category === "string" ? req.query.category : undefined,
      view: view ?? (status ? undefined : "canonical"),
      adminList: true,
      limit: req.query.limit ? Number(req.query.limit) : ADMIN_CATALOG_LIST_LIMIT
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
    const { fileName, dataBase64 } = req.body as {
      fileName?: string;
      dataBase64?: string;
    };
    const uploaded = await persistNormalizedCatalogPhoto({
      userId: req.auth!.userId,
      fileName,
      dataBase64: dataBase64 ?? ""
    });
    res.status(201).json({ url: uploaded.url, objectKey: uploaded.objectKey });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.get("/catalog/image-queue", async (req, res, next) => {
  try {
    const parsed = listCatalogImageQueueSchema.parse({
      tab: typeof req.query.tab === "string" ? req.query.tab : undefined,
      pack: typeof req.query.pack === "string" ? req.query.pack : undefined,
      priority: typeof req.query.priority === "string" ? req.query.priority : undefined,
      q: typeof req.query.q === "string" ? req.query.q : ""
    });
    const result = await listImageQueue(parsed);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post("/catalog/image-queue/:id/candidate", async (req, res, next) => {
  try {
    const { fileName, dataBase64 } = req.body as {
      fileName?: string;
      dataBase64?: string;
    };
    const item = await uploadAcquisitionCandidate(String(req.params.id), {
      userId: req.auth!.userId,
      fileName,
      dataBase64: dataBase64 ?? ""
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
});

catalogAdminRouter.post(
  "/catalog/image-queue/:id/reject",
  validateBody(rejectCatalogImageAcquisitionSchema),
  async (req, res, next) => {
    try {
      const item = await rejectAcquisitionPhoto(String(req.params.id), req.body);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  }
);

catalogAdminRouter.post(
  "/catalog/image-queue/:id/assign",
  validateBody(assignCatalogImageAcquisitionSchema),
  async (req, res, next) => {
    try {
      const item = await assignValidatedAcquisition(String(req.params.id), req.body);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  }
);

catalogAdminRouter.get("/merchants/:id/catalog/search", async (req, res, next) => {
  try {
    const rawLimit = req.query.limit ? Number(req.query.limit) : 30;
    const parsed = searchCatalogProductsSchema.parse({
      q: typeof req.query.q === "string" ? req.query.q : "",
      includePendingForMerchantId: String(req.params.id),
      limit: Math.min(Number.isFinite(rawLimit) ? rawLimit : 30, MERCHANT_CATALOG_SEARCH_LIMIT_MAX)
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
