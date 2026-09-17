/**
 * DUTS catalog foundation regressions (DB required).
 * Run from apps/api: npx tsx scripts/test-catalog-foundation.ts
 */
import assert from "node:assert/strict";
import { prisma } from "../src/config/prisma.js";
import {
  createCatalogProduct,
  findSimilarCatalogProducts,
  linkCatalogProductToMerchant,
  migrateExistingProductsToCatalog,
  searchCatalogProducts,
  setCatalogProductStatus,
  submitMerchantNewCatalogProduct,
  updateCatalogProduct
} from "../src/modules/commerce/catalog.service.js";
import { normalizeBarcode } from "@gigflow/shared";

async function main() {
  assert.equal(normalizeBarcode("123"), null);
  assert.equal(normalizeBarcode("12345678"), "12345678");
  assert.equal(normalizeBarcode("12-345-678-9012"), "123456789012");

  const stamp = Date.now();
  const merchant = await prisma.merchant.create({
    data: {
      name: `Catalog Test Shop ${stamp}`,
      contactName: "Tester",
      phone: "+12035550100",
      whatsappPhone: `+1203555${String(stamp).slice(-4)}`,
      locationLabel: "Test",
      latitude: 41.5,
      longitude: -72.8,
      category: "TUCK_SHOP"
    }
  });

  const merchantB = await prisma.merchant.create({
    data: {
      name: `Catalog Test Shop B ${stamp}`,
      contactName: "Tester B",
      phone: "+12035550101",
      whatsappPhone: `+1203556${String(stamp).slice(-4)}`,
      locationLabel: "Test",
      latitude: 41.51,
      longitude: -72.81,
      category: "TUCK_SHOP"
    }
  });

  try {
    const created = await createCatalogProduct({
      name: `Coca-Cola Original 2L ${stamp}`,
      brand: "Coca-Cola",
      category: "Drinks",
      sizeLabel: "2L",
      barcode: `890${String(stamp).slice(-10)}`
    });
    assert.equal(created.status, "APPROVED");
    assert.equal(created.primaryImageUrl, null);

    const edited = await updateCatalogProduct(created.id, {
      description: "Classic cola"
    });
    assert.equal(edited.description, "Classic cola");

    const pending = await createCatalogProduct(
      {
        name: `Merchant Cola ${stamp}`,
        category: "Drinks",
        primaryImageUrl: "https://example.com/cola.png",
        status: "PENDING",
        source: "MERCHANT_SUBMISSION"
      },
      { submittedByMerchantId: merchant.id }
    );
    assert.equal(pending.status, "PENDING");

    const approved = await setCatalogProductStatus(pending.id, "APPROVED", "admin-test");
    assert.equal(approved.status, "APPROVED");

    await setCatalogProductStatus(pending.id, "ARCHIVED");
    const archivedSearch = await searchCatalogProducts({ q: `Merchant Cola ${stamp}`, status: "ARCHIVED" });
    assert.ok(archivedSearch.products.some((p) => p.id === pending.id));

    const barcodeDup = await findSimilarCatalogProducts({
      name: "Other",
      barcode: created.barcode!
    });
    assert.ok(barcodeDup.exactBarcodeMatch?.id === created.id);

    const similar = await findSimilarCatalogProducts({
      name: `Coca-Cola Original 2L ${stamp}`,
      brand: "Coca-Cola",
      sizeLabel: "2L"
    });
    assert.ok(similar.similar.length >= 1);

    const offerA = await linkCatalogProductToMerchant(merchant.id, {
      catalogProductId: created.id,
      priceCents: 200,
      currency: "usd",
      available: true
    });
    const offerB = await linkCatalogProductToMerchant(merchantB.id, {
      catalogProductId: created.id,
      priceCents: 230,
      currency: "usd",
      available: true
    });
    assert.equal(offerA.priceCents, 200);
    assert.equal(offerB.priceCents, 230);
    assert.equal(offerA.catalogProductId, created.id);
    assert.equal(offerB.catalogProductId, created.id);

    const submitConfirm = await submitMerchantNewCatalogProduct(merchant.id, {
      name: `Unique Snack ${stamp}`,
      category: "Snacks",
      primaryImageUrl: "https://example.com/snack.png",
      priceCents: 150,
      forceCreate: false
    });
    assert.equal(submitConfirm.requiresConfirmation, false);
    if (!submitConfirm.requiresConfirmation) {
      assert.equal(submitConfirm.catalogProduct.status, "PENDING");
      assert.equal(submitConfirm.product.merchantId, merchant.id);
      assert.equal(submitConfirm.product.available, true);
    }

    // Compatibility: legacy product without catalog link survives migration
    const legacy = await prisma.product.create({
      data: {
        merchantId: merchant.id,
        name: `Legacy Bread ${stamp}`,
        normalizedName: `legacy bread ${stamp}`,
        priceCents: 120,
        currency: "usd",
        available: true,
        category: "Bakery"
      }
    });
    const beforePrice = legacy.priceCents;
    const beforeAvail = legacy.available;
    const report = await migrateExistingProductsToCatalog();
    assert.ok(report.merchantProductsBefore >= 1);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal(after.priceCents, beforePrice);
    assert.equal(after.available, beforeAvail);
    assert.ok(after.catalogProductId);

    // Order item snapshots untouched shape check
    const orderItemFields = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'CommerceOrderItem'`
    );
    const cols = orderItemFields.map((c) => c.column_name);
    assert.ok(cols.includes("productNameSnapshot"));
    assert.ok(cols.includes("unitPriceCents"));
    assert.ok(cols.includes("lineTotalCents"));

    console.log(
      JSON.stringify(
        {
          ok: true,
          migration: report,
          offers: { a: offerA.priceCents, b: offerB.priceCents }
        },
        null,
        2
      )
    );
  } finally {
    await prisma.product.deleteMany({
      where: { merchantId: { in: [merchant.id, merchantB.id] } }
    });
    await prisma.catalogProduct.deleteMany({
      where: {
        OR: [
          { name: { contains: String(stamp) } },
          { submittedByMerchantId: { in: [merchant.id, merchantB.id] } }
        ]
      }
    });
    await prisma.merchant.deleteMany({ where: { id: { in: [merchant.id, merchantB.id] } } });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
