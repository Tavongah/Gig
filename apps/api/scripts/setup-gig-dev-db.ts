/**
 * Create/reset disposable GigFlow DB and apply all migrations from zero.
 * Does NOT touch production or the IA SaaS database (duts_whitelabel).
 *
 * Usage (from apps/api):
 *   npx tsx scripts/setup-gig-dev-db.ts
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import pg from "pg";

const here = fileURLToPath(new URL(".", import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) {
  throw new Error("DATABASE_URL required");
}

const dbName = process.env.GIG_DEV_DB_NAME ?? "duts_gig_dev";
const adminUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, "/postgres$1");
const targetUrl = sourceUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

async function main() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) {
    console.log(`Creating database ${dbName}...`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } else {
    console.log(`Database ${dbName} already exists (keeping data; migrate deploy is idempotent).`);
  }
  await client.end();

  console.log(`Applying migrations to ${dbName}...`);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: targetUrl },
    cwd: resolve(here, "..")
  });
  execSync("npx prisma generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: targetUrl },
    cwd: resolve(here, "..")
  });

  console.log(`\nReady. Use:\n  DATABASE_URL=${targetUrl}\n  or GIG_TEST_DATABASE_URL=${targetUrl}`);
  console.log(
    "\nRoot cause note: duts_whitelabel on :5433 belongs to the IA SaaS product (different _prisma_migrations)."
  );
  console.log("GigFlow must use its own database (duts_gig_dev) — never migrate into duts_whitelabel.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
