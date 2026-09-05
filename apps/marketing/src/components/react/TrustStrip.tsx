import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { EASE } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

const DEFAULT_LABELS = [
  "Home Services",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Healthcare",
  "Hospitality",
  "Education",
  "Growing Teams"
];

type TrustStripProps = {
  labels?: readonly string[];
  headline?: string;
};

export default function TrustStrip({
  labels = DEFAULT_LABELS,
  headline = "Built for businesses that want to work smarter."
}: TrustStripProps) {
  const reduced = usePrefersReducedMotion();
  const items = labels.length ? labels : DEFAULT_LABELS;
  // The track is duplicated so translating it by -50% loops seamlessly.
  const track = [...items, ...items];

  return (
    <section className="duts-trust" aria-label="Industries served">
      <div className="duts-container">
        <motion.p
          className="duts-trust__headline"
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        >
          {headline}
        </motion.p>
      </div>

      <div className="duts-trust__marquee" data-reduced={reduced ? "true" : "false"}>
        <div
          className="duts-trust__track"
          style={
            { "--duts-marquee-duration": `${Math.max(items.length * 4.5, 26)}s` } as CSSProperties
          }
        >
          {track.map((label, i) => (
            <span className="duts-trust__item" key={`${label}-${i}`} aria-hidden={i >= items.length}>
              <span className="duts-trust__spark" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export { TrustStrip };
