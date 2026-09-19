/**
 * H4 acquisition assignment safety (DB required, no production catalog IDs).
 * Run from apps/api: npx tsx scripts/test-catalog-image-acquisition-db.ts
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { prisma } from "../src/config/prisma.js";
import {
  assignValidatedAcquisition,
  rejectAcquisitionPhoto,
  uploadAcquisitionCandidate
} from "../src/modules/commerce/catalog-image-acquisition.service.js";

async function jpegBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 180, g: 20, b: 20 } }
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return buf.toString("base64");
}

async function main() {
  const stamp = Date.now();
  const productA = await prisma.catalogProduct.create({
    data: {
      name: `H4 Cola ${stamp}`,
      normalizedName: `h4 cola ${stamp}`,
      brand: "H4-Test",
      category: "Soft Drinks",
      sizeLabel: "500ml",
      barcode: `891${String(stamp).slice(-10)}`
    }
  });
  const productB = await prisma.catalogProduct.create({
    data: {
      name: `H4 Cola ${stamp}`,
      normalizedName: `h4 cola ${stamp} 2l`,
      brand: "H4-Test",
      category: "Soft Drinks",
      sizeLabel: "2L",
      barcode: `892${String(stamp).slice(-10)}`
    }
  });
  const merchantBefore = await prisma.product.count();
  const ordersBefore = await prisma.commerceOrder.count();
  const itemsBefore = await prisma.commerceOrderItem.count();

  const acqA = await prisma.catalogImageAcquisition.create({
    data: {
      catalogProductId: productA.id,
      queueKind: "BRANDED",
      plannedName: productA.name,
      plannedBrand: productA.brand,
      plannedSizeLabel: productA.sizeLabel,
      plannedCategory: productA.category,
      brandFamily: "H4-Test",
      acquisitionPack: "PACK_A_BEVERAGES",
      acquisitionPriority: "BRANDED_PRIORITY_A",
      regionalPackageRisk: "LOW",
      status: "NEEDS_IMAGE_ACQUISITION"
    }
  });
  const acqB = await prisma.catalogImageAcquisition.create({
    data: {
      catalogProductId: productB.id,
      queueKind: "BRANDED",
      plannedName: productB.name,
      plannedBrand: productB.brand,
      plannedSizeLabel: productB.sizeLabel,
      plannedCategory: productB.category,
      brandFamily: "H4-Test",
      acquisitionPack: "PACK_A_BEVERAGES",
      acquisitionPriority: "BRANDED_PRIORITY_A",
      regionalPackageRisk: "LOW",
      status: "NEEDS_IMAGE_ACQUISITION"
    }
  });

  try {
    await assert.rejects(
      () =>
        assignValidatedAcquisition(acqA.id, {
          catalogProductId: productA.id,
          sourceType: "DUTS_OWN_PHOTO",
          checks: {
            brandMatches: true,
            productMatches: true,
            sizeMatches: true,
            flavorMatches: true,
            packageTypeMatches: true,
            imageClear: true,
            noWatermark: true,
            noPriceOverlay: true
          }
        }),
      (err: Error & { code?: string }) => err.code === "VALIDATION_REQUIRED"
    );

    const dataBase64 = await jpegBase64();
    await uploadAcquisitionCandidate(acqA.id, {
      userId: "00000000-0000-4000-8000-0000000000h4",
      dataBase64
    });

    const rejected = await rejectAcquisitionPhoto(acqA.id, { reason: "BLURRY" });
    assert.equal(rejected.acquisitionStatus, "REJECTED");
    const afterReject = await prisma.catalogProduct.findUnique({ where: { id: productA.id } });
    assert.equal(afterReject?.primaryImageUrl, null);

    await uploadAcquisitionCandidate(acqA.id, {
      userId: "00000000-0000-4000-8000-0000000000h4",
      dataBase64
    });

    const assigned = await assignValidatedAcquisition(acqA.id, {
      catalogProductId: productA.id,
      sourceType: "MERCHANT_SUPPLIED_PHOTO",
      capturedByLabel: "H4 test",
      checks: {
        brandMatches: true,
        productMatches: true,
        sizeMatches: true,
        flavorMatches: true,
        packageTypeMatches: true,
        imageClear: true,
        noWatermark: true,
        noPriceOverlay: true
      }
    });
    assert.equal(assigned.acquisitionStatus, "UPLOADED");
    assert.ok(assigned.livePrimaryImageUrl);

    const sibling = await prisma.catalogProduct.findUnique({ where: { id: productB.id } });
    assert.equal(sibling?.primaryImageUrl, null, "wrong-size image must not propagate");
    const siblingAcq = await prisma.catalogImageAcquisition.findUnique({ where: { id: acqB.id } });
    assert.equal(siblingAcq?.status, "NEEDS_IMAGE_ACQUISITION");

    await assert.rejects(
      () =>
        assignValidatedAcquisition(acqA.id, {
          catalogProductId: productA.id,
          sourceType: "DUTS_OWN_PHOTO",
          checks: {
            brandMatches: true,
            productMatches: true,
            sizeMatches: true,
            flavorMatches: true,
            packageTypeMatches: true,
            imageClear: true,
            noWatermark: true,
            noPriceOverlay: true
          }
        }),
      (err: Error & { code?: string }) => err.code === "IMAGE_ALREADY_EXISTS"
    );

    await assert.rejects(
      () =>
        assignValidatedAcquisition(acqA.id, {
          catalogProductId: productB.id,
          sourceType: "DUTS_OWN_PHOTO",
          checks: {
            brandMatches: true,
            productMatches: true,
            sizeMatches: true,
            flavorMatches: true,
            packageTypeMatches: true,
            imageClear: true,
            noWatermark: true,
            noPriceOverlay: true
          }
        }),
      (err: Error & { code?: string }) => err.code === "IDENTITY_MISMATCH"
    );

    assert.equal(await prisma.product.count(), merchantBefore);
    assert.equal(await prisma.commerceOrder.count(), ordersBefore);
    assert.equal(await prisma.commerceOrderItem.count(), itemsBefore);
    const images = await prisma.catalogProductImage.findMany({ where: { catalogProductId: productA.id } });
    assert.ok(images.some((img) => img.isPrimary));
  } finally {
    await prisma.catalogImageAcquisitionAsset.deleteMany({
      where: { acquisitionId: { in: [acqA.id, acqB.id] } }
    });
    await prisma.catalogImageAcquisition.deleteMany({ where: { id: { in: [acqA.id, acqB.id] } } });
    await prisma.catalogProductImage.deleteMany({
      where: { catalogProductId: { in: [productA.id, productB.id] } }
    });
    await prisma.catalogProduct.deleteMany({ where: { id: { in: [productA.id, productB.id] } } });
  }
}

main()
  .then(() => {
    console.log(JSON.stringify({ ok: true, db: "PASS" }, null, 2));
  })
  .catch(async (err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
