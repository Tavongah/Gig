import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { Router } from "express";
import { localMediaAbsolutePath, PRODUCT_IMAGE_KEY_RE } from "../../lib/spaces.js";

export const catalogMediaRouter = Router();

catalogMediaRouter.get("/product-image/:file", async (req, res, next) => {
  try {
    const objectKey = `product-image/${String(req.params.file ?? "")}`;
    if (!PRODUCT_IMAGE_KEY_RE.test(objectKey)) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const dest = localMediaAbsolutePath(objectKey);
    try {
      await access(dest);
    } catch {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.type("image/jpeg");
    createReadStream(dest).pipe(res);
  } catch (err) {
    next(err);
  }
});
