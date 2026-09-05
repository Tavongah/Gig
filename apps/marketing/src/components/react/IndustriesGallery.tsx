import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { industryGallery } from "../../data/photos";
import { EASE, VIEWPORT } from "./anim";
import "../../styles/home.css";

export function IndustriesGallery() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const current = industryGallery[active] ?? industryGallery[0];

  return (
    <section className="duts-section duts-industries-gallery duts-section--light" aria-labelledby="duts-industries-title">
      <div className="duts-container">
        <motion.header
          className="duts-section__head"
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: reduced ? 0 : 0.55, ease: EASE }}
        >
          <p className="duts-eyebrow">
            <span className="duts-eyebrow__pip" />
            Industries
          </p>
          <h2 className="duts-section__title duts-section__title--wide" id="duts-industries-title">
            Practical AI for businesses that keep work moving.
          </h2>
          <p className="duts-section__lead">
            Real environments. Real pressure. DUTS helps teams respond faster, stay organized and
            grow without adding another layer of complexity.
          </p>
        </motion.header>

        <div className="duts-industries-gallery__layout">
          <div className="duts-industries-gallery__tabs" role="tablist" aria-label="Industries">
            {industryGallery.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                onClick={() => setActive(i)}
                onMouseEnter={() => {
                  if (!reduced && window.matchMedia("(hover: hover)").matches) setActive(i);
                }}
              >
                <span>{item.name}</span>
                <em>{item.overlay}</em>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              className="duts-industries-gallery__stage"
              role="tabpanel"
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
            >
              <div className="duts-industries-gallery__photo">
                <img
                  src={current.image}
                  alt={current.alt}
                  width={1400}
                  height={900}
                  loading="lazy"
                  decoding="async"
                />
                <div className="duts-industries-gallery__caption">
                  <strong>{current.overlay}</strong>
                  <p>{current.useCase}</p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

export default IndustriesGallery;
