import {
  merchantCanFulfillFlavor,
  normalizeFlavorName,
  parseProductFlavorOptionsEnabled,
  type FlavorOptionPublic,
  type FlavorPreference
} from "@gigflow/shared";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../lib/errors.js";

export function flavorOptionsEnabled(): boolean {
  return parseProductFlavorOptionsEnabled(process.env.PRODUCT_FLAVOR_OPTIONS_ENABLED);
}

export function presentFlavorOption(row: {
  id: string;
  name: string;
  sortOrder: number;
}): FlavorOptionPublic {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder };
}

export async function listFlavorOptions(catalogProductId: string, activeOnly = false) {
  return prisma.catalogProductFlavorOption.findMany({
    where: { catalogProductId, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
}

export async function flavorNamesByCatalogId(catalogProductIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!catalogProductIds.length) return map;
  const rows = await prisma.catalogProductFlavorOption.findMany({
    where: { catalogProductId: { in: catalogProductIds }, active: true },
    select: { catalogProductId: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  for (const row of rows) {
    const list = map.get(row.catalogProductId) ?? [];
    list.push(row.name);
    map.set(row.catalogProductId, list);
  }
  return map;
}

export async function createFlavorOption(catalogProductId: string, name: string) {
  const catalog = await prisma.catalogProduct.findUnique({ where: { id: catalogProductId } });
  if (!catalog) throw new AppError("Catalog product not found.", 404, "CATALOG_PRODUCT_NOT_FOUND");
  const trimmed = name.trim();
  if (!trimmed) throw new AppError("Flavor name is required.", 400, "FLAVOR_NAME_REQUIRED");
  const normalizedName = normalizeFlavorName(trimmed);
  const existing = await prisma.catalogProductFlavorOption.findUnique({
    where: { catalogProductId_normalizedName: { catalogProductId, normalizedName } }
  });
  if (existing) {
    if (!existing.active) {
      return prisma.catalogProductFlavorOption.update({
        where: { id: existing.id },
        data: { active: true, name: trimmed }
      });
    }
    throw new AppError("That flavor already exists on this product.", 409, "FLAVOR_EXISTS");
  }
  const maxSort = await prisma.catalogProductFlavorOption.aggregate({
    where: { catalogProductId },
    _max: { sortOrder: true }
  });
  return prisma.catalogProductFlavorOption.create({
    data: {
      catalogProductId,
      name: trimmed,
      normalizedName,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      active: true
    }
  });
}

export async function updateFlavorOption(
  flavorId: string,
  patch: { name?: string; active?: boolean; sortOrder?: number }
) {
  const existing = await prisma.catalogProductFlavorOption.findUnique({ where: { id: flavorId } });
  if (!existing) throw new AppError("Flavor not found.", 404, "FLAVOR_NOT_FOUND");
  const name = patch.name?.trim();
  const normalizedName = name ? normalizeFlavorName(name) : undefined;
  if (normalizedName && normalizedName !== existing.normalizedName) {
    const clash = await prisma.catalogProductFlavorOption.findUnique({
      where: {
        catalogProductId_normalizedName: {
          catalogProductId: existing.catalogProductId,
          normalizedName
        }
      }
    });
    if (clash && clash.id !== existing.id) {
      throw new AppError("That flavor already exists on this product.", 409, "FLAVOR_EXISTS");
    }
  }
  return prisma.catalogProductFlavorOption.update({
    where: { id: flavorId },
    data: {
      ...(name ? { name, normalizedName } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {})
    }
  });
}

export async function setProductFlavorAvailability(
  productId: string,
  flavorOptionId: string,
  available: boolean
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new AppError("Product not found.", 404, "PRODUCT_NOT_FOUND");
  const flavor = await prisma.catalogProductFlavorOption.findUnique({ where: { id: flavorOptionId } });
  if (!flavor || flavor.catalogProductId !== product.catalogProductId) {
    throw new AppError("Flavor not found for this product.", 404, "FLAVOR_NOT_FOUND");
  }
  return prisma.productFlavorAvailability.upsert({
    where: { productId_flavorOptionId: { productId, flavorOptionId } },
    create: { productId, flavorOptionId, available },
    update: { available }
  });
}

export type ResolvedLineFlavor = {
  flavorOptionId: string | null;
  flavorName: string | null;
  flavorPreference: FlavorPreference | null;
};

export async function resolveLineFlavor(input: {
  catalogProductId?: string | null;
  productId: string;
  flavorOptionId?: string | null;
  flavorPreference?: string | null;
}): Promise<ResolvedLineFlavor> {
  const none: ResolvedLineFlavor = { flavorOptionId: null, flavorName: null, flavorPreference: null };
  if (!flavorOptionsEnabled() || !input.catalogProductId) return none;

  const flavors = await listFlavorOptions(input.catalogProductId, true);
  if (!flavors.length) return none;

  const flavorId = input.flavorOptionId?.trim() || null;
  if (flavorId) {
    const flavor = flavors.find((f) => f.id === flavorId);
    if (!flavor) {
      throw new AppError("That flavor is not available.", 409, "FLAVOR_UNAVAILABLE");
    }
    const stock = await prisma.productFlavorAvailability.findUnique({
      where: { productId_flavorOptionId: { productId: input.productId, flavorOptionId: flavor.id } }
    });
    if (stock && !stock.available) {
      throw new AppError(`${flavor.name} is not available at this shop.`, 409, "FLAVOR_UNAVAILABLE");
    }
    return { flavorOptionId: flavor.id, flavorName: flavor.name, flavorPreference: "SPECIFIC" };
  }

  const availableIds = flavors.map((f) => f.id);
  const unavailable = await prisma.productFlavorAvailability.findMany({
    where: { productId: input.productId, flavorOptionId: { in: availableIds }, available: false }
  });
  const ok = merchantCanFulfillFlavor({
    flavorPreference: "ANY",
    activeFlavorIds: availableIds,
    unavailableFlavorIds: unavailable.map((u) => u.flavorOptionId)
  });
  if (!ok) {
    throw new AppError("No flavors of this product are available at this shop.", 409, "FLAVOR_UNAVAILABLE");
  }
  return { flavorOptionId: null, flavorName: null, flavorPreference: "ANY" };
}

export async function coverageFlavorMaps(productIds: string[]) {
  const unavailable = new Map<string, string[]>();
  const active = new Map<string, string[]>();
  if (!productIds.length || !flavorOptionsEnabled()) return { unavailable, active };
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      catalogProductId: true,
      catalogProduct: { select: { flavorOptions: { where: { active: true }, select: { id: true } } } },
      flavorAvailability: { select: { flavorOptionId: true, available: true } }
    }
  });
  for (const product of products) {
    active.set(product.id, product.catalogProduct?.flavorOptions.map((f) => f.id) ?? []);
    unavailable.set(
      product.id,
      product.flavorAvailability.filter((row) => !row.available).map((row) => row.flavorOptionId)
    );
  }
  return { unavailable, active };
}
