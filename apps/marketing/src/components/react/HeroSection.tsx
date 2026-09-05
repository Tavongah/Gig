import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import BusinessSignalAnimation from "./BusinessSignalAnimation";
import { EASE, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

const EMPHASIS = ["SELL.", "SERVE.", "GROW."];
const CYCLE_MS = 1900;

export default function HeroSection() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % EMPHASIS.length);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  const line = {
    hidden: { opacity: reduced ? 1 : 0, y: reduced ? 0 : 24 },
    visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.7, ease: EASE } }
  };

  return (
    <section className="duts-hero" aria-labelledby="duts-hero-title">
      <div className="duts-hero__aura" data-reduced={reduced ? "true" : "false"} />

      <div className="duts-container duts-hero__grid">
        <motion.div
          className="duts-hero__copy"
          variants={staggerContainer(reduced, 0.09)}
          initial="hidden"
          animate="visible"
        >
          <motion.p className="duts-eyebrow" variants={line}>
            <span className="duts-eyebrow__pip" />
            Practical AI for real businesses
          </motion.p>

          <h1 className="duts-hero__title" id="duts-hero-title">
            <motion.span className="duts-hero__line" variants={line}>
              AI that helps businesses
            </motion.span>

            <motion.span className="duts-hero__emphasis" variants={line}>
              {EMPHASIS.map((word, i) => (
                <span
                  key={word}
                  className="duts-hero__word"
                  data-active={!reduced && active === i ? "true" : "false"}
                  data-reduced={reduced ? "true" : "false"}
                >
                  {word}
                </span>
              ))}
            </motion.span>
          </h1>

          <motion.p className="duts-hero__lead" variants={line}>
            DUTS AI builds intelligent products and custom AI solutions that help businesses attract
            customers, automate operations and work smarter.
          </motion.p>

          <motion.div className="duts-btn-row" variants={line}>
            <a className="duts-btn duts-btn--primary" href="/contact">
              Talk to DUTS
              <span aria-hidden="true">→</span>
            </a>
            <a className="duts-btn duts-btn--ghost" href="/solutions">
              Explore AI Solutions
            </a>
          </motion.div>

          <motion.p className="duts-hero__meta" variants={line}>
            Products you can use today
            <span className="duts-hero__meta-dot" aria-hidden="true" />
            Solutions built around your business
          </motion.p>
        </motion.div>

        <motion.div
          className="duts-hero__visual"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, delay: 0.15, ease: EASE }}
        >
          <BusinessSignalAnimation />
        </motion.div>
      </div>
    </section>
  );
}

export { HeroSection };
