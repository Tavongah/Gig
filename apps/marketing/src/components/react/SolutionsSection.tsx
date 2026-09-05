import { motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type Solution = {
  id: string;
  name: string;
  outcome: string;
  summary: string;
  capabilities: readonly string[];
};

type SolutionsSectionProps = {
  solutions: readonly Solution[];
  title?: string;
  eyebrow?: string;
  lead?: string;
};

const MAX_PILLS = 4;

export default function SolutionsSection({
  solutions,
  eyebrow = "Solutions",
  title = "AI that solves real business problems.",
  lead = "Every DUTS solution starts with a business outcome — more customers, faster answers, less manual work — then gets built to fit the way your business already runs."
}: SolutionsSectionProps) {
  const reduced = usePrefersReducedMotion();
  const count = solutions.length;

  // The first card always spans two columns. When the resulting cell count would
  // leave a single hole in the last row, the closing card widens too.
  const lastIsWide = count > 3 && (count + 1) % 3 === 2;

  return (
    <section className="duts-section duts-solutions" id="solutions" aria-labelledby="duts-solutions-title">
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
          <motion.h2 className="duts-section__title" id="duts-solutions-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
        </motion.header>

        <motion.div
          className="duts-solutions__grid"
          variants={staggerContainer(reduced, 0.07)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          {solutions.map((solution, i) => {
            const featured = i === 0;
            const wide = featured || (lastIsWide && i === count - 1);
            const pills = featured ? solution.capabilities : solution.capabilities.slice(0, MAX_PILLS);
            const hidden = featured ? 0 : Math.max(solution.capabilities.length - MAX_PILLS, 0);

            return (
              <motion.a
                key={solution.id}
                className="duts-solution"
                data-wide={wide ? "true" : "false"}
                data-featured={featured ? "true" : "false"}
                href={`/solutions#${solution.id}`}
                variants={fadeUp(reduced, 24)}
                whileHover={reduced ? undefined : { y: -6 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <span className="duts-solution__glow" aria-hidden="true" />

                <span className="duts-solution__index" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <h3 className="duts-solution__name">{solution.name}</h3>
                <p className="duts-solution__outcome">{solution.outcome}</p>
                <p className="duts-solution__summary">{solution.summary}</p>

                <span className="duts-solution__pills">
                  {pills.map((capability) => (
                    <span className="duts-pill" key={capability}>
                      {capability}
                    </span>
                  ))}
                  {hidden > 0 && <span className="duts-pill duts-pill--muted">+{hidden} more</span>}
                </span>

                <span className="duts-solution__cta">
                  See this solution
                  <span aria-hidden="true">→</span>
                </span>
              </motion.a>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

export { SolutionsSection };
