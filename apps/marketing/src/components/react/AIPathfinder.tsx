import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type PathfinderOption = {
  id: string;
  label: string;
  solutions: readonly string[];
  message: string;
};

type AIPathfinderProps = {
  options: readonly PathfinderOption[];
  eyebrow?: string;
  title?: string;
  lead?: string;
};

export default function AIPathfinder({
  options,
  eyebrow = "AI Pathfinder",
  title = "Where could AI help your business?",
  lead = "Pick the challenge that sounds most like your business. We'll point you at a practical starting point."
}: AIPathfinderProps) {
  const reduced = usePrefersReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = options.find((option) => option.id === selectedId) ?? null;

  return (
    <section className="duts-section duts-pathfinder" aria-labelledby="duts-pathfinder-title">
      <div className="duts-container">
        <div className="duts-pathfinder__shell">
          <span className="duts-pathfinder__wash" aria-hidden="true" />

          <motion.header
            className="duts-section__head duts-section__head--center"
            variants={staggerContainer(reduced, 0.07)}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT_WIDE}
          >
            <motion.p className="duts-eyebrow" variants={fadeUp(reduced, 14)}>
              <span className="duts-eyebrow__pip" />
              {eyebrow}
            </motion.p>
            <motion.h2 className="duts-section__title" id="duts-pathfinder-title" variants={fadeUp(reduced)}>
              {title}
            </motion.h2>
            <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
              {lead}
            </motion.p>
          </motion.header>

          <motion.div
            className="duts-pathfinder__options"
            role="group"
            aria-label="Business challenges"
            variants={staggerContainer(reduced, 0.05)}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT_WIDE}
          >
            {options.map((option) => {
              const isActive = option.id === selectedId;
              return (
                <motion.button
                  type="button"
                  key={option.id}
                  className="duts-pathfinder__chip"
                  data-active={isActive ? "true" : "false"}
                  aria-pressed={isActive}
                  onClick={() => setSelectedId(isActive ? null : option.id)}
                  variants={fadeUp(reduced, 12, 0.45)}
                  whileHover={reduced ? undefined : { y: -2 }}
                  whileTap={reduced ? undefined : { scale: 0.98 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  {option.label}
                </motion.button>
              );
            })}
          </motion.div>

          <div className="duts-pathfinder__result" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {selected ? (
                <motion.div
                  key={selected.id}
                  className="duts-pathfinder__card"
                  initial={{ opacity: 0, y: reduced ? 0 : 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -10 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.28, ease: EASE }}
                >
                  <span className="duts-pathfinder__card-label">Recommended starting point</span>

                  <div className="duts-pathfinder__solutions">
                    {selected.solutions.map((solution, i) => (
                      <motion.span
                        className="duts-pathfinder__solution"
                        key={solution}
                        initial={{ opacity: 0, scale: reduced ? 1 : 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={
                          reduced ? { duration: 0 } : { duration: 0.25, delay: 0.06 + i * 0.06, ease: EASE }
                        }
                      >
                        {solution}
                      </motion.span>
                    ))}
                  </div>

                  <p className="duts-pathfinder__message">{selected.message}</p>

                  <a
                    className="duts-btn duts-btn--primary"
                    href={`/contact?intent=${encodeURIComponent(selected.id)}`}
                  >
                    Discuss This Solution
                    <span aria-hidden="true">→</span>
                  </a>
                </motion.div>
              ) : (
                <motion.p
                  key="empty"
                  className="duts-pathfinder__empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.24, ease: EASE }}
                >
                  Select a challenge above to see the solutions we'd recommend.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export { AIPathfinder };
