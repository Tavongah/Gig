import { motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type Industry = {
  name: string;
  useCase: string;
};

type IndustriesSectionProps = {
  industries: readonly Industry[];
  eyebrow?: string;
  title?: string;
  lead?: string;
};

export default function IndustriesSection({
  industries,
  eyebrow = "Industries",
  title = "Built for the businesses that keep the world moving.",
  lead = "Different industries, same pressure: missed enquiries, manual admin and opportunities that quietly slip away."
}: IndustriesSectionProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="duts-section duts-industries" id="industries" aria-labelledby="duts-industries-title">
      <div className="duts-container">
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
          <motion.h2 className="duts-section__title duts-section__title--wide" id="duts-industries-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
        </motion.header>

        <motion.div
          className="duts-industries__grid"
          variants={staggerContainer(reduced, 0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          {industries.map((industry, i) => (
            <motion.article
              className="duts-industry"
              key={industry.name}
              variants={fadeUp(reduced, 20)}
              whileHover={reduced ? undefined : { y: -5 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <span className="duts-industry__line" aria-hidden="true" />
              <span className="duts-industry__index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="duts-industry__name">{industry.name}</h3>
              <p className="duts-industry__use">{industry.useCase}</p>
            </motion.article>
          ))}
        </motion.div>

        <motion.div
          className="duts-industries__foot"
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        >
          <p>Don't see your industry? The problems are usually the same underneath.</p>
          <a className="duts-btn duts-btn--ghost" href="/industries">
            See all industries
            <span aria-hidden="true">→</span>
          </a>
        </motion.div>
      </div>
    </section>
  );
}

export { IndustriesSection };
