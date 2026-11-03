import pg from "pg";

const connectionString = process.env.DATABASE_URL
  ?.replace(/([?&])schema=[^&]*/g, "$1")
  .replace("?&", "?")
  .replace(/[?&]$/, "");
if (!connectionString) {
  console.error("DATABASE_URL is required before the API can accept traffic.");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'Gig'
       AND column_name IN ('customerDeliveryEstimateStart', 'customerDeliveryEstimateEnd')`
  );
  const names = new Set(result.rows.map((row) => row.column_name));
  if (!names.has("customerDeliveryEstimateStart") || !names.has("customerDeliveryEstimateEnd")) {
    console.error("Delivery estimate columns are missing. Refusing to accept traffic.");
    process.exit(1);
  }
  console.log("Delivery estimate columns verified.");
} finally {
  await client.end();
}
