import { motion } from "framer-motion";
import { VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type Principle = {
  title: string;
  body: string;
};

type WhyDutsProps = {
  principles: readonly Principle[];
  eyebrow?: string;
  title?: string;
  lead?: string;
};

export default function WhyDuts({
  principles,
  eyebrow = "Why DUTS",
  title = "AI should solve problems — not create new ones.",
  lead = "We build AI that fits into real businesses: practical, connected to the tools you already use, and easy to live with."
}: WhyDutsProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="duts-section duts-section--light duts-why" aria-labelledby="duts-why-title">
      <div className="duts-container duts-why__grid">
        <motion.header
          className="duts-section__head"
          variants={staggerContainer(reduced, 0.07)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          <motion.p className="duts-eyebrow" variants={fadeUp(reduced, 14)}>
            <span className="duts-eyebrow__pip" />
            {eyebrow}
          </motion.p>
          <motion.h2 className="duts-section__title" id="duts-why-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
        </motion.header>

        <motion.div
          className="duts-why__list"
          variants={staggerContainer(reduced, 0.09)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          {principles.map((principle, i) => (
            <motion.article className="duts-principle" key={principle.title} variants={fadeUp(reduced, 20)}>
              <span className="duts-principle__num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="duts-principle__title">{principle.title}</h3>
                <p className="duts-principle__body">{principle.body}</p>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

export { WhyDuts };
