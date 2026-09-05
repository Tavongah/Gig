import { motion } from "framer-motion";
import { VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

export type PanelItem = {
  name: string;
  description: string;
};

const DEFAULT_PRODUCTS: PanelItem[] = [
  { name: "AI Landing Pages", description: "Conversion-focused pages built to generate leads." },
  { name: "AI Lead Assistant", description: "Qualify and follow up with enquiries automatically." },
  { name: "AI Customer Assistant", description: "Always-on support trained on your business." },
  { name: "Business AI Workspace", description: "Internal answers from your company knowledge." }
];

const DEFAULT_SOLUTIONS: PanelItem[] = [
  { name: "Custom AI Agents", description: "Agents designed around your workflows." },
  { name: "Automation", description: "End-to-end operational automation." },
  { name: "Document AI", description: "Document understanding at scale." },
  { name: "AI Integrations", description: "AI inside your existing stack." },
  { name: "Internal AI Assistants", description: "Private assistants for your team." }
];

type ProductsVsSolutionsProps = {
  products?: readonly PanelItem[];
  solutions?: readonly PanelItem[];
  eyebrow?: string;
  title?: string;
  lead?: string;
};

export default function ProductsVsSolutions({
  products = DEFAULT_PRODUCTS,
  solutions = DEFAULT_SOLUTIONS,
  eyebrow = "Two ways to work with DUTS",
  title = "Start with a product. Or build something custom.",
  lead = "Some businesses need something working next week. Others need AI shaped around a workflow nobody else has. DUTS does both."
}: ProductsVsSolutionsProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="duts-section duts-split" aria-labelledby="duts-split-title">
      <div className="duts-container">
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
          <motion.h2 className="duts-section__title" id="duts-split-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
        </motion.header>

        <motion.div
          className="duts-split__grid"
          variants={staggerContainer(reduced, 0.12)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          <motion.article className="duts-split__panel" data-tone="products" variants={fadeUp(reduced, 26)}>
            <span className="duts-split__wash" aria-hidden="true" />
            <span className="duts-split__tag">AI Products</span>
            <h3 className="duts-split__title">Ready to use. Live quickly.</h3>
            <p className="duts-split__copy">
              Proven AI products for the problems most businesses share — answering customers, capturing
              leads and turning traffic into revenue.
            </p>
            <ul className="duts-split__list">
              {products.map((item) => (
                <li key={item.name}>
                  <span className="duts-split__bullet" aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <em>{item.description}</em>
                  </span>
                </li>
              ))}
            </ul>
            <a className="duts-btn duts-btn--primary duts-split__cta" href="/products">
              Explore Products
              <span aria-hidden="true">→</span>
            </a>
          </motion.article>

          <motion.article className="duts-split__panel" data-tone="solutions" variants={fadeUp(reduced, 26)}>
            <span className="duts-split__wash" aria-hidden="true" />
            <span className="duts-split__tag">Custom AI Solutions</span>
            <h3 className="duts-split__title">Built around how you work.</h3>
            <p className="duts-split__copy">
              When your business has its own systems, data and processes, we design and build AI that fits
              them instead of forcing a rewrite.
            </p>
            <ul className="duts-split__list">
              {solutions.map((item) => (
                <li key={item.name}>
                  <span className="duts-split__bullet" aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <em>{item.description}</em>
                  </span>
                </li>
              ))}
            </ul>
            <a className="duts-btn duts-btn--ghost duts-split__cta" href="/contact">
              Discuss a Solution
              <span aria-hidden="true">→</span>
            </a>
          </motion.article>
        </motion.div>
      </div>
    </section>
  );
}

export { ProductsVsSolutions };
