import { defineConfig } from "astro/config";

const site = process.env.PUBLIC_SITE_URL || "https://www.duts.tech";

export default defineConfig({
  site,
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto"
  },
  vite: {
    build: {
      cssMinify: true
    }
  }
});
