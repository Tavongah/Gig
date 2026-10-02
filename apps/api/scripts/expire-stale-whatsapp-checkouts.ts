/**
 * Safe one-time cleanup of expired unfinished WhatsApp checkout drafts.
 * Never cancels placed orders or mutates payments.
 *
 * Run: npx tsx scripts/expire-stale-whatsapp-checkouts.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });
loadEnv({ path: resolve(here, "../.env") });

const { expireStaleCheckoutConversations } = await import(
  "../src/modules/whatsapp/conversation.service.js"
);
const n = await expireStaleCheckoutConversations();
const { prisma } = await import("../src/config/prisma.js");
await prisma.$disconnect();
console.log(JSON.stringify({ ok: true, expiredDrafts: n }, null, 2));
process.exit(0);
