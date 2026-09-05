import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE, VIEWPORT } from "./anim";
import "../../styles/home.css";

type Props = {
  image: string;
  alt: string;
  eyebrow?: string;
  title: string;
  copy: string;
  demoLabel?: string;
  reverse?: boolean;
  tone?: "dark" | "light";
  children: ReactNode;
};

export function PhotoStory({
  image,
  alt,
  eyebrow,
  title,
  copy,
  demoLabel = "Example workflow",
  reverse = false,
  tone = "dark",
  children
}: Props) {
  const reduced = useReducedMotion();

  return (
    <section className={`duts-section duts-photo-story duts-photo-story--${tone}`} data-reverse={reverse ? "true" : "false"}>
      <div className="duts-container duts-photo-story__grid">
        <motion.div
          className="duts-photo-story__media"
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: reduced ? 0 : 0.7, ease: EASE }}
        >
          <img src={image} alt={alt} width={1400} height={1050} loading="lazy" decoding="async" />
          <div className="duts-photo-story__float">{children}</div>
          <span className="duts-demo-tag">{demoLabel}</span>
        </motion.div>

        <motion.div
          className="duts-photo-story__copy"
          initial={reduced ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: reduced ? 0 : 0.6, delay: reduced ? 0 : 0.08, ease: EASE }}
        >
          {eyebrow ? (
            <p className="duts-eyebrow">
              <span className="duts-eyebrow__pip" />
              {eyebrow}
            </p>
          ) : null}
          <h2 className="duts-section__title duts-section__title--wide">{title}</h2>
          <p className="duts-section__lead">{copy}</p>
        </motion.div>
      </div>
    </section>
  );
}
