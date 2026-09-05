import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { EASE } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds to wait before the entrance starts. */
  delay?: number;
  /** Pixels travelled on the Y axis. Use 0 for a pure fade. */
  y?: number;
  duration?: number;
  once?: boolean;
  amount?: number;
};

export default function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  duration = 0.65,
  once = true,
  amount = 0.25
}: RevealProps) {
  const reduced = usePrefersReducedMotion();
  const shown = { opacity: 1, y: 0 };

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={shown}
      animate={reduced ? shown : undefined}
      viewport={{ once, amount }}
      transition={reduced ? { duration: 0 } : { duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export { Reveal };
