/**
 * Static checks for storefront motion tokens and reduced-motion support.
 * Run: npx tsx scripts/test-storefront-motion.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const src = join(root, "src");

function read(rel: string) {
  const p = join(src, rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

const motion = read("lib/motion.ts");
assert.ok(motion.includes("fast: 150"), "fast token");
assert.ok(motion.includes("normal: 220"), "normal token");
assert.ok(motion.includes("section: 360"), "section token");
assert.ok(!motion.includes("800"), "no long UI durations");
assert.ok(motion.includes("RAIL_PEEK"), "rail peek");
assert.ok(!motion.includes("Popular"), "no fake popularity in motion notes used as copy");

const reduce = read("lib/use-reduced-motion.ts");
assert.ok(reduce.includes("prefers-reduced-motion"), "web reduced motion");
assert.ok(reduce.includes("isReduceMotionEnabled"), "native reduced motion");

const css = readFileSync(join(root, "global.css"), "utf8");
assert.ok(css.includes("prefers-reduced-motion"), "CSS reduced motion");
assert.ok(css.includes("duts-product-card"), "product card motion class");
assert.ok(css.includes("transform"), "compositor-friendly transform");
assert.ok(!css.includes("@keyframes duts-marquee"), "no conveyor animation");

const pkg = readFileSync(join(root, "package.json"), "utf8");
assert.ok(!pkg.includes("framer-motion"), "no framer-motion");
assert.ok(!pkg.includes("lottie"), "no lottie");
assert.ok(!pkg.includes("\"gsap\""), "no gsap");
assert.ok(!pkg.includes("swiper"), "no swiper");

const press = read("components/motion/PressScale.tsx");
assert.ok(press.includes("useReducedMotion"), "press respects reduced motion");

const reveal = read("components/motion/SectionReveal.tsx");
assert.ok(reveal.includes("IntersectionObserver"), "web section entrance");
assert.ok(reveal.includes("useReducedMotion"), "section respects reduced motion");

const badge = read("components/motion/CountBadge.tsx");
assert.ok(badge.includes("useNativeDriver: true"), "badge uses transform driver");
assert.ok(badge.includes("useReducedMotion"), "badge respects reduced motion");

console.log(JSON.stringify({ ok: true }, null, 2));
