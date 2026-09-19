import type {
  CatalogImageAcquisitionPack,
  CatalogImageAcquisitionPriority,
  CatalogImageQueueKind,
  CatalogImageQueueTab
} from "@gigflow/shared";
import { BRANDED_ACQUISITION_PLAN as BRANDED_PLAN_RAW } from "./catalog-image-acquisition.branded.js";

export type AcquisitionPlanRow = {
  catalogProductId: string;
  queueKind: CatalogImageQueueKind;
  exceptionQueue: string | null;
  plannedName: string;
  plannedBrand: string | null;
  plannedSizeLabel: string | null;
  plannedCategory: string;
  brandFamily: string | null;
  acquisitionPack: CatalogImageAcquisitionPack | null;
  acquisitionPriority: CatalogImageAcquisitionPriority | null;
  regionalPackageRisk: "LOW" | "MEDIUM" | "HIGH" | null;
  brandMetadataReview: boolean;
  likelyBrand: string | null;
  referenceImageUrl: string | null;
  notes: string | null;
};

export const GENERIC_EXCEPTION_PLAN: AcquisitionPlanRow[] = [
  {
    catalogProductId: "e421c4f1-fa18-4d32-a318-46c6ef4ab3d9",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "HUMAN_REVIEW",
    plannedName: "Chocolate Bar",
    plannedBrand: null,
    plannedSizeLabel: "each",
    plannedCategory: "Sweets",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Do not generate a branded chocolate bar. Photograph the exact bar sold, or leave imageless until brand is identified."
  },
  {
    catalogProductId: "d1da0504-ad41-4ab2-b38e-a32903c3b516",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "HUMAN_REVIEW",
    plannedName: "Infant Formula",
    plannedBrand: null,
    plannedSizeLabel: "400g",
    plannedCategory: "Baby Products",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: "HIGH",
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "High-risk. Official tin or merchant photo of the exact 400g SKU only. Never approximate NAN/SMA/Lactogen."
  },
  {
    catalogProductId: "4fcf8dd0-f018-41e4-b451-aaf5ba7e5ec4",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "GENERATION_DIFFICULTY",
    plannedName: "AA Batteries",
    plannedBrand: null,
    plannedSizeLabel: "4",
    plannedCategory: "Student / Everyday Essentials",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph a real 4-count AA pack. Count must MATCH 4."
  },
  {
    catalogProductId: "82e4b413-f188-447b-a5b3-34f02fb57a4a",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "GENERATION_DIFFICULTY",
    plannedName: "Baby Cereal",
    plannedBrand: null,
    plannedSizeLabel: "250g",
    plannedCategory: "Baby Products",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph actual infant cereal. Previous generated image looked like TVP."
  },
  {
    catalogProductId: "4c467bb3-ee51-498e-811f-80274816f8c3",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "GENERATION_DIFFICULTY",
    plannedName: "Exercise Book",
    plannedBrand: null,
    plannedSizeLabel: "each",
    plannedCategory: "Student / Everyday Essentials",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph a real unbranded or locally printed school book. No fake crests."
  },
  {
    catalogProductId: "31fd3097-96a8-4e5d-8231-3529c8d24a37",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "COUNT_OR_SIZE_SENSITIVE",
    plannedName: "Bottled Water",
    plannedBrand: null,
    plannedSizeLabel: "10L",
    plannedCategory: "Water",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph an actual 10L container sold in Zimbabwe, not a 5L jug or cooler."
  },
  {
    catalogProductId: "4a926905-38f3-4ce1-97ed-a1ae73006748",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "COUNT_OR_SIZE_SENSITIVE",
    plannedName: "Pine Gel",
    plannedBrand: null,
    plannedSizeLabel: "5L",
    plannedCategory: "Household Cleaning",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph a real 5L pine gel jerry. Size must be readable."
  },
  {
    catalogProductId: "a7e1b3cf-24d4-4cf6-8f33-97d332e82e66",
    queueKind: "GENERIC_EXCEPTION",
    exceptionQueue: "COUNT_OR_SIZE_SENSITIVE",
    plannedName: "Stock Cubes Chicken",
    plannedBrand: null,
    plannedSizeLabel: "12",
    plannedCategory: "Cooking Ingredients",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: null,
    notes: "Photograph a real 12-count pack. Visible count must be 12."
  }
];

export const LEGACY_REVIEW_PLAN: AcquisitionPlanRow[] = [
  {
    catalogProductId: "fcc4bbae-540e-499e-aecb-a75069ddce40",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Beef tripe (maguru )",
    plannedBrand: "Irvine’s",
    plannedSizeLabel: "1kg",
    plannedCategory: "Groceries",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/6ba362f8-0108-4611-a0c2-7ff9eb02f452.jpg",
    notes: "QUESTIONABLE: STALE_CATEGORY. Read-only in H4."
  },
  {
    catalogProductId: "82cc387e-61c3-40dc-9d51-889c03ee78d9",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Broiler chicken",
    plannedBrand: "Irvine’s",
    plannedSizeLabel: "1.5kg",
    plannedCategory: "Groceries",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/dc6474c2-13a2-45f3-a371-f3fea2fc3295.jpg",
    notes: "QUESTIONABLE: STALE_CATEGORY. Read-only in H4."
  },
  {
    catalogProductId: "3d4596f0-9f92-4ced-a557-7cf8602d17b1",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Chicken feet’s n heads",
    plannedBrand: "Irvine’s",
    plannedSizeLabel: "1kg",
    plannedCategory: "Groceries",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/b6039d4c-02cf-4539-b71d-ebdea3399f91.jpg",
    notes: "QUESTIONABLE: STALE_CATEGORY. Read-only in H4."
  },
  {
    catalogProductId: "2a8d1c76-b59b-417f-9c55-7129ed752c39",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Gizzards",
    plannedBrand: "Irvine’s",
    plannedSizeLabel: "500g",
    plannedCategory: "Groceries",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/511535ba-7112-4c68-94bd-cd90879f29ee.jpg",
    notes: "QUESTIONABLE: STALE_CATEGORY. Read-only in H4."
  },
  {
    catalogProductId: "871b6cfc-d2df-4502-b43b-8b4e370afc2c",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Instant Noodles",
    plannedBrand: "Kelloggs",
    plannedSizeLabel: "70g",
    plannedCategory: "Convenience Foods",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/8b12746f-a767-4ef2-9b0d-f4760643d99c.jpg",
    notes: "WRONG_PRODUCT_OR_BRAND. Do not repair in H4."
  },
  {
    catalogProductId: "cde8184e-e01e-4f11-a7ad-1a71be5ced4c",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Mazondo",
    plannedBrand: "Irvine’s",
    plannedSizeLabel: "1kg",
    plannedCategory: "Groceries",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/169b1db6-2318-4448-9d5a-51e744167f58.jpg",
    notes: "QUESTIONABLE: STALE_CATEGORY. Read-only in H4."
  },
  {
    catalogProductId: "7dadda14-5c44-423e-beaf-b0d3b1723a6a",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Mirinda",
    plannedBrand: "Pepsi",
    plannedSizeLabel: "1L",
    plannedCategory: "Soft Drinks",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: null,
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/2ca7e92f-1636-4f44-a0ab-47cc3bfb700f.jpg",
    notes: "QUESTIONABLE: IMAGE_IDENTITY_REVIEW. Read-only in H4."
  },
  {
    catalogProductId: "69a9cae4-04ac-499a-bf66-cb9b3e86097f",
    queueKind: "LEGACY_REVIEW",
    exceptionQueue: null,
    plannedName: "Vaseline",
    plannedBrand: "Blueseal",
    plannedSizeLabel: "450ml",
    plannedCategory: "Personal Care",
    brandFamily: null,
    acquisitionPack: null,
    acquisitionPriority: null,
    regionalPackageRisk: "HIGH",
    brandMetadataReview: false,
    likelyBrand: null,
    referenceImageUrl: "https://api.duts.tech/v1/media/product-image/acf20304-0077-467e-8abf-84445a6b44c0.jpg",
    notes: "QUESTIONABLE: IMAGE_IDENTITY_REVIEW. Read-only in H4."
  }
];

export const BRANDED_ACQUISITION_PLAN: AcquisitionPlanRow[] = BRANDED_PLAN_RAW.map((row) => ({
  ...row,
  exceptionQueue: row.exceptionQueue,
  plannedBrand: row.plannedBrand,
  plannedSizeLabel: row.plannedSizeLabel,
  brandFamily: row.brandFamily,
  acquisitionPack: row.acquisitionPack,
  acquisitionPriority: row.acquisitionPriority,
  regionalPackageRisk: row.regionalPackageRisk,
  likelyBrand: row.likelyBrand ?? null,
  referenceImageUrl: row.referenceImageUrl,
  notes: row.notes
}));

export const ALL_ACQUISITION_PLAN: AcquisitionPlanRow[] = [
  ...BRANDED_ACQUISITION_PLAN,
  ...GENERIC_EXCEPTION_PLAN,
  ...LEGACY_REVIEW_PLAN
];

export const PACK_LABELS: Record<CatalogImageAcquisitionPack, string> = {
  PACK_A_BEVERAGES: "Beverages",
  PACK_B_HOUSEHOLD: "Household",
  PACK_C_SNACKS: "Snacks",
  PACK_D_BREAKFAST: "Breakfast",
  PACK_E_PERSONAL_CARE: "Personal Care"
};

export type QueueFilterInput = {
  tab: CatalogImageQueueTab;
  pack?: CatalogImageAcquisitionPack;
  priority?: CatalogImageAcquisitionPriority;
  q?: string;
};

export type FilterableAcquisition = {
  catalogProductId: string;
  queueKind: CatalogImageQueueKind;
  exceptionQueue: string | null;
  plannedName: string;
  plannedBrand: string | null;
  plannedSizeLabel: string | null;
  plannedCategory: string;
  brandFamily: string | null;
  likelyBrand: string | null;
  acquisitionPack: string | null;
  acquisitionPriority: string | null;
  status: string;
  hasLiveImage: boolean;
};

export function rowIsComplete(row: FilterableAcquisition): boolean {
  return row.status === "UPLOADED" || row.hasLiveImage;
}

export function matchesQueueSearch(row: FilterableAcquisition, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.plannedName,
    row.plannedBrand,
    row.likelyBrand,
    row.plannedSizeLabel,
    row.plannedCategory,
    row.brandFamily
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function filterAcquisitionQueue<T extends FilterableAcquisition>(
  rows: T[],
  input: QueueFilterInput
): T[] {
  return rows.filter((row) => {
    if (input.tab === "branded" && row.queueKind !== "BRANDED") return false;
    if (input.tab === "exceptions" && row.queueKind !== "GENERIC_EXCEPTION") return false;
    if (input.tab === "human-review" && row.exceptionQueue !== "HUMAN_REVIEW") return false;
    if (input.tab === "legacy" && row.queueKind !== "LEGACY_REVIEW") return false;
    if (input.tab === "completed") {
      if (row.queueKind === "LEGACY_REVIEW") return false;
      if (!rowIsComplete(row)) return false;
    }
    if (input.tab === "all-missing") {
      if (row.queueKind === "LEGACY_REVIEW") return false;
      if (rowIsComplete(row)) return false;
    }
    if (input.pack && row.acquisitionPack !== input.pack) return false;
    if (input.priority && row.acquisitionPriority !== input.priority) return false;
    return matchesQueueSearch(row, input.q ?? "");
  });
}

const PRIORITY_RANK: Record<string, number> = {
  BRANDED_PRIORITY_A: 0,
  BRANDED_PRIORITY_B: 1,
  BRANDED_PRIORITY_C: 2
};

export function sortAcquisitionQueue<T extends FilterableAcquisition>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = PRIORITY_RANK[a.acquisitionPriority ?? ""] ?? 9;
    const pb = PRIORITY_RANK[b.acquisitionPriority ?? ""] ?? 9;
    if (pa !== pb) return pa - pb;
    const pack = (a.acquisitionPack ?? "").localeCompare(b.acquisitionPack ?? "");
    if (pack !== 0) return pack;
    const name = a.plannedName.localeCompare(b.plannedName);
    if (name !== 0) return name;
    return (a.plannedSizeLabel ?? "").localeCompare(b.plannedSizeLabel ?? "");
  });
}

export function packProgressFromRows(rows: FilterableAcquisition[]) {
  return (Object.keys(PACK_LABELS) as CatalogImageAcquisitionPack[]).map((pack) => {
    const members = rows.filter((r) => r.queueKind === "BRANDED" && r.acquisitionPack === pack);
    const complete = members.filter((r) => rowIsComplete(r)).length;
    return {
      pack,
      label: PACK_LABELS[pack],
      total: members.length,
      complete
    };
  });
}

export function identityMatchesPlan(live: {
  name: string;
  brand: string | null;
  sizeLabel: string | null;
}, plan: { plannedName: string; plannedSizeLabel: string | null; brandMetadataReview: boolean }): boolean {
  if (live.name.trim().toLowerCase() !== plan.plannedName.trim().toLowerCase()) return false;
  const liveSize = (live.sizeLabel ?? "").trim().toLowerCase();
  const planSize = (plan.plannedSizeLabel ?? "").trim().toLowerCase();
  return liveSize === planSize;
}

export const MOBILE_CAPTURE_INSTRUCTIONS = [
  "Photograph one product only.",
  "Show the front of the package.",
  "Make brand, product and size visible.",
  "Keep the whole package in frame.",
  "Avoid glare and blur.",
  "Do not cover the product with your hand.",
  "Do not use screenshots or downloaded internet images.",
  "Use the real product sold locally."
];
