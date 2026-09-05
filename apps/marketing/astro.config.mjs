import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = process.env.PUBLIC_SITE_URL || "https://www.duts.tech";
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");

export default defineConfig({
  site,
  output: "static",
  integrations: [react()],
  compressHTML: true,
  build: {
    inlineStylesheets: "auto"
  },
  vite: {
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        react: path.resolve(repoRoot, "node_modules/react"),
        "react-dom": path.resolve(repoRoot, "node_modules/react-dom")
      }
    },
    build: {
      cssMinify: true
    }
  }
});
