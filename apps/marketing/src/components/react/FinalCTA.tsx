import { motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

type FinalCTAProps = {
  title?: string;
  lead?: string;
};

export default function FinalCTA({
  title = "What's slowing your business down?",
  lead = "Tell us the problem. We'll show you the practical AI path forward — starting with one thing worth fixing."
}: FinalCTAProps) {
  const reduced = usePrefersReducedMotion();

  const orb = (delay: number) =>
    reduced
      ? undefined
      : {
          x: [0, 26, -18, 0],
          y: [0, -22, 16, 0],
          scale: [1, 1.08, 0.96, 1],
          transition: { duration: 18, repeat: Infinity, ease: "easeInOut" as const, delay }
        };

  return (
    <section className="duts-final" aria-labelledby="duts-final-title">
      <div className="duts-final__field" aria-hidden="true">
        <motion.span className="duts-final__orb duts-final__orb--cyan" animate={orb(0)} />
        <motion.span className="duts-final__orb duts-final__orb--violet" animate={orb(2.5)} />
        <motion.span className="duts-final__orb duts-final__orb--blue" animate={orb(5)} />
        <span className="duts-final__grid" />
      </div>

      <motion.div
        className="duts-container duts-final__inner"
        variants={staggerContainer(reduced, 0.09)}
        initial="hidden"
        whileInView="visible"
        viewport={VIEWPORT_WIDE}
      >
        <motion.p className="duts-eyebrow" variants={fadeUp(reduced, 14)}>
          <span className="duts-eyebrow__pip" />
          Let's talk
        </motion.p>

        <motion.h2 className="duts-final__title" id="duts-final-title" variants={fadeUp(reduced, 26)}>
          {title}
        </motion.h2>

        <motion.p className="duts-final__lead" variants={fadeUp(reduced)}>
          {lead}
        </motion.p>

        <motion.div className="duts-btn-row duts-final__actions" variants={fadeUp(reduced)}>
          <motion.a
            className="duts-btn duts-btn--primary duts-btn--lg"
            href="/contact"
            whileHover={reduced ? undefined : { y: -2 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            Talk to DUTS
            <span aria-hidden="true">→</span>
          </motion.a>
          <motion.a
            className="duts-btn duts-btn--ghost duts-btn--lg"
            href="/solutions"
            whileHover={reduced ? undefined : { y: -2 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            Explore Solutions
          </motion.a>
        </motion.div>
      </motion.div>
    </section>
  );
}

export { FinalCTA };
