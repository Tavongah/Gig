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
const home = read("screens/commerce/ShopHomeScreen.tsx");
assert.ok(home.includes("SectionReveal"), "home uses section entrance");
assert.ok(!home.includes("Popular"), "no fake popularity");

const badge = read("components/motion/CountBadge.tsx");
assert.ok(badge.includes("useNativeDriver: true"), "badge uses transform driver");
assert.ok(badge.includes("useReducedMotion"), "badge respects reduced motion");

const card = read("components/ProductCard.tsx");
assert.ok(card.includes("duts-product-card"), "card motion class");
assert.ok(!card.includes("Added ✓"), "clipped Added acknowledgement removed from card");
assert.ok(card.includes("h-8 w-8"), "compact add");
assert.ok(card.includes("0.92"), "press scale feedback preserved");

const rail = read("components/ProductGrid.tsx");
assert.ok(rail.includes("snapToInterval"), "rail snap");
assert.ok(rail.includes("RAIL_PEEK"), "next-card peek");
assert.ok(rail.includes("Previous products"), "desktop previous");
assert.ok(!rail.includes("auto-scroll") && !rail.includes("setInterval"), "no auto conveyor");

const tabs = read("navigation/GuestTabs.tsx");
assert.ok(tabs.includes("CountBadge"), "cart badge motion");
const cart = read("screens/commerce/CartScreen.tsx");
assert.ok(cart.includes("Continue with WhatsApp"), "WhatsApp CTA preserved");
assert.ok(cart.includes("commerceGuestHandoff"), "handoff unchanged");
assert.ok(cart.includes("duts-cta-ready"), "restrained CTA cue");
assert.ok(!cart.includes("setInterval"), "CTA does not pulse");

console.log(JSON.stringify({ ok: true }, null, 2));
