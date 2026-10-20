/**
 * DUTS storefront motion tokens. Presentation only.
 *
 * Benchmark (patterns, not brands):
 * - Horizontal rails with a peek of the next card → swipe affordance without copy
 * - Immediate add acknowledgement (button ✓ + badge pop) after successful state
 * - Hover/press on cards via transform/opacity only
 * - Skeleton placeholders matching card size
 * - Section fade/translate on enter, never 50 individual cards
 * Rejected: aggressive auto-scrolling conveyors, confetti, fake urgency, page-transition routing.
 * Slow ambient horizontal rail drift is allowed when reduced-motion is off.
 */

export const MOTION = {
  fast: 150,
  normal: 220,
  section: 360,
  cssEasing: "cubic-bezier(0.22, 1, 0.36, 1)"
} as const;

export const RAIL_CARD_WIDTH = 152;
export const RAIL_GAP = 16;
export const RAIL_PEEK = 28;
export const RAIL_SNAP = RAIL_CARD_WIDTH + RAIL_GAP;
/** Slow ambient rail drift. Presentation only; does not change product order. */
export const RAIL_AMBIENT_PX_PER_SEC = 12;
export const RAIL_AMBIENT_IDLE_MS = 4200;
export const RAIL_AMBIENT_END_PAUSE_MS = 2000;
