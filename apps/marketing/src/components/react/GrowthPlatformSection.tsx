import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

const DEFAULT_PILLS = [
  "Conversion-focused landing pages",
  "Instant lead capture",
  "AI chat on every page",
  "Appointment booking",
  "Automatic follow-up",
  "CRM handoff",
  "Mobile-first performance",
  "Search-ready structure"
];

const FIELDS = [
  { label: "Full name", value: "Sarah Mitchell" },
  { label: "Email", value: "sarah@brightside.co" },
  { label: "What do you need?", value: "Quote for a full home clean" }
];

/** 0-2 fill a field, 3 submits, 4 shows the captured lead. */
const STEP_COUNT = 5;
const STEP_MS = 1500;

type GrowthPlatformSectionProps = {
  eyebrow?: string;
  title?: string;
  lead?: string;
  pills?: readonly string[];
  closingLine?: string;
};

export default function GrowthPlatformSection({
  eyebrow = "Growth platform",
  title = "Turn traffic into customers.",
  lead = "Most business websites are brochures — they look fine and do nothing. DUTS builds AI-powered landing pages and growth platforms designed around one job: turning visitors into qualified conversations.",
  pills = DEFAULT_PILLS,
  closingLine = "Your website shouldn't just look good. It should help your business grow."
}: GrowthPlatformSectionProps) {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(reduced ? STEP_COUNT - 1 : 0);

  useEffect(() => {
    if (reduced) {
      setStep(STEP_COUNT - 1);
      return;
    }
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEP_COUNT), STEP_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  const submitting = step === 3;
  const captured = step >= 3;

  return (
    <section className="duts-section duts-growth" aria-labelledby="duts-growth-title">
      <div className="duts-container duts-growth__grid">
        <motion.div
          className="duts-growth__copy"
          variants={staggerContainer(reduced, 0.08)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_WIDE}
        >
          <motion.p className="duts-eyebrow" variants={fadeUp(reduced, 14)}>
            <span className="duts-eyebrow__pip" />
            {eyebrow}
          </motion.p>
          <motion.h2 className="duts-section__title" id="duts-growth-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>

          <motion.ul className="duts-growth__pills" variants={fadeUp(reduced)}>
            {pills.map((pill) => (
              <li className="duts-pill duts-pill--lg" key={pill}>
                {pill}
              </li>
            ))}
          </motion.ul>

          <motion.p className="duts-growth__closing" variants={fadeUp(reduced)}>
            {closingLine}
          </motion.p>

          <motion.div className="duts-btn-row" variants={fadeUp(reduced)}>
            <a className="duts-btn duts-btn--primary" href="/products">
              Explore AI Landing Pages
              <span aria-hidden="true">→</span>
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          className="duts-growth__visual"
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT_WIDE}
          transition={reduced ? { duration: 0 } : { duration: 0.8, ease: EASE }}
          aria-hidden="true"
        >
          <div className="duts-growth-scene">
            <div className="duts-growth-scene__photo">
              <img
                src="/images/stories/growth-cleaning.jpg"
                alt=""
                width={1400}
                height={1050}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="duts-growth-scene__browser">
          <div className="duts-browser">
            <div className="duts-browser__bar">
              <span className="duts-browser__dot" />
              <span className="duts-browser__dot" />
              <span className="duts-browser__dot" />
              <span className="duts-browser__url">
                <span className="duts-browser__lock" />
                greenlineclean.com
              </span>
            </div>

            <div className="duts-browser__viewport">
              <div className="duts-mock__nav">
                <span className="duts-mock__logo" />
                <span className="duts-mock__links">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="duts-mock__navcta" />
              </div>

              <div className="duts-mock__body">
                <div className="duts-mock__hero">
                  <span className="duts-mock__badge">Demo · Greenline Cleaning</span>
                  <span className="duts-mock__h1" />
                  <span className="duts-mock__h1 duts-mock__h1--short" />
                  <span className="duts-mock__text" />
                  <span className="duts-mock__text duts-mock__text--short" />
                  <span className="duts-mock__cta">Get a free quote</span>
                </div>

                <div className="duts-mock__form">
                  <span className="duts-mock__form-title">Request a quote</span>

                  {FIELDS.map((field, i) => (
                    <span
                      className="duts-mock__field"
                      key={field.label}
                      data-active={step === i ? "true" : "false"}
                      data-filled={step > i ? "true" : "false"}
                    >
                      <span className="duts-mock__field-label">{field.label}</span>
                      <span className="duts-mock__field-value">
                        {step >= i ? field.value : ""}
                        {step === i && <span className="duts-mock__caret" data-reduced={reduced ? "true" : "false"} />}
                      </span>
                    </span>
                  ))}

                  <span className="duts-mock__submit" data-busy={submitting ? "true" : "false"}>
                    {submitting ? "Sending…" : "Send request"}
                  </span>
                </div>
              </div>

              <AnimatePresence>
                {captured && (
                  <motion.div
                    className="duts-mock__toast"
                    initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: reduced ? 0 : -8 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.4, ease: EASE }}
                  >
                    <span className="duts-mock__toast-tick">✓</span>
                    <span>
                      <strong>New lead captured</strong>
                      <em>Qualified · Routed to your CRM</em>
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="duts-mock__chat" data-reduced={reduced ? "true" : "false"}>
                <span className="duts-mock__chat-pulse" />
                <span className="duts-mock__chat-bubble">
                  <span className="duts-mock__chat-title">Ask anything</span>
                  <span className="duts-mock__typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </div>
            </div>
          </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export { GrowthPlatformSection };
