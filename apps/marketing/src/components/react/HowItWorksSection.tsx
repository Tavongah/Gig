import { motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type HowStep = {
  n: string;
  title: string;
  body: string;
};

type HowItWorksSectionProps = {
  steps: readonly HowStep[];
  eyebrow?: string;
  title?: string;
  lead?: string;
};

export default function HowItWorksSection({
  steps,
  eyebrow = "How it works",
  title = "From business problem to working AI.",
  lead = "A clear, practical path — no long research projects, no unnecessary complexity."
}: HowItWorksSectionProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="duts-section duts-how" id="how-it-works" aria-labelledby="duts-how-title">
      <div className="duts-container duts-how__grid">
        <motion.header
          className="duts-section__head duts-how__head"
          variants={staggerContainer(reduced, 0.07)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          <motion.p className="duts-eyebrow" variants={fadeUp(reduced, 14)}>
            <span className="duts-eyebrow__pip" />
            {eyebrow}
          </motion.p>
          <motion.h2 className="duts-section__title" id="duts-how-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
          <motion.div className="duts-btn-row" variants={fadeUp(reduced)}>
            <a className="duts-btn duts-btn--ghost" href="/how-it-works">
              See the full process
              <span aria-hidden="true">→</span>
            </a>
          </motion.div>
        </motion.header>

        <motion.ol
          className="duts-how__steps"
          variants={staggerContainer(reduced, 0.12)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          <motion.span
            className="duts-how__spine"
            aria-hidden="true"
            initial={{ scaleY: reduced ? 1 : 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={VIEWPORT_WIDE}
            transition={reduced ? { duration: 0 } : { duration: 1.1, ease: EASE }}
          />

          {steps.map((step) => (
            <motion.li className="duts-how__step" key={step.n} variants={fadeUp(reduced, 22)}>
              <span className="duts-how__marker">
                <span className="duts-how__marker-ring" aria-hidden="true" />
                <span className="duts-how__marker-n">{step.n}</span>
              </span>
              <div className="duts-how__content">
                <h3 className="duts-how__title">{step.title}</h3>
                <p className="duts-how__body">{step.body}</p>
              </div>
            </motion.li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}

export { HowItWorksSection };
