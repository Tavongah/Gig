import type { Transition, Variants } from "framer-motion";

/** Soft "expo out" curve used across the marketing site. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const VIEWPORT = { once: true, amount: 0.25 } as const;
export const VIEWPORT_WIDE = { once: true, amount: 0.15 } as const;

export function transition(reduced: boolean, duration = 0.6, delay = 0): Transition {
  return reduced ? { duration: 0 } : { duration, delay, ease: EASE };
}

/** Parent wrapper that releases its children one after another. */
export function staggerContainer(reduced: boolean, stagger = 0.08, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: reduced
        ? { staggerChildren: 0, delayChildren: 0 }
        : { staggerChildren: stagger, delayChildren }
    }
  };
}

export function fadeUp(reduced: boolean, distance = 20, duration = 0.6): Variants {
  return {
    hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : distance },
    visible: { opacity: 1, y: 0, transition: transition(reduced, duration) }
  };
}

export function fadeIn(reduced: boolean, duration = 0.5): Variants {
  return {
    hidden: { opacity: reduced ? 1 : 0 },
    visible: { opacity: 1, transition: transition(reduced, duration) }
  };
}

export function scaleIn(reduced: boolean, from = 0.94, duration = 0.6): Variants {
  return {
    hidden: { opacity: reduced ? 1 : 0, scale: reduced ? 1 : from },
    visible: { opacity: 1, scale: 1, transition: transition(reduced, duration) }
  };
}
