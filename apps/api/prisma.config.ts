import "dotenv/config";
import { defineConfig } from "prisma/config";

const isGenerateCommand = process.argv.includes("generate");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && !isGenerateCommand) {
  throw new Error("DATABASE_URL is required for Prisma commands that connect to the database.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: databaseUrl ?? "postgresql://postgres:postgres@localhost:5432/gigflow"
  }
});
