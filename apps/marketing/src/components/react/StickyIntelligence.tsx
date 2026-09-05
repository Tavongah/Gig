import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "./anim";
import "../../styles/home.css";

const stages = [
  {
    id: "customer",
    n: "01",
    title: "Customer",
    body: "A customer sends a message from your website, WhatsApp or email.",
    visual: "New enquiry · water heater leaking · needs help tomorrow"
  },
  {
    id: "understand",
    n: "02",
    title: "Understand",
    body: "DUTS understands the intent, urgency and what information is missing.",
    visual: "Intent: service request · Urgency: high · Needs: schedule"
  },
  {
    id: "act",
    n: "03",
    title: "Act",
    body: "It checks business knowledge — services, availability, policies — then prepares the next step.",
    visual: "Service matched · Window found · Draft ready"
  },
  {
    id: "complete",
    n: "04",
    title: "Complete",
    body: "The customer gets an answer. The appointment is offered. Your team stays in control.",
    visual: "Appointment booked · 10:00 AM · Confirmation sent"
  },
  {
    id: "learn",
    n: "05",
    title: "Learn",
    body: "The interaction becomes business context — so the next conversation starts smarter.",
    visual: "Context saved · Preference noted · Ready for follow-up"
  }
] as const;

export function StickyIntelligence() {
  const reduced = useReducedMotion();
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const nodes = refs.current.filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible?.target) return;
        const idx = Number((visible.target as HTMLElement).dataset.index);
        if (!Number.isNaN(idx)) setActive(idx);
      },
      { threshold: [0.35, 0.55, 0.7], rootMargin: "-20% 0px -35% 0px" }
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [reduced]);

  const current = stages[active] ?? stages[0];

  return (
    <section className="duts-section duts-sticky" aria-labelledby="duts-sticky-title">
      <div className="duts-container">
        <header className="duts-section__head duts-sticky__intro">
          <p className="duts-eyebrow">
            <span className="duts-eyebrow__pip" />
            The DUTS system
          </p>
          <h2 className="duts-section__title duts-section__title--wide" id="duts-sticky-title">
            One intelligence layer.
            <br />
            Across your business.
          </h2>
          <p className="duts-section__lead">
            DUTS sits between your customers, knowledge and operations — so every channel can work
            from the same understanding of how you do business.
          </p>
        </header>

        <div className="duts-sticky__layout">
          <div className="duts-sticky__panel" aria-hidden={reduced ? undefined : true}>
            <div className="duts-sticky__core">
              <span>DUTS AI</span>
              <strong>{current.title}</strong>
              <p>{current.visual}</p>
            </div>
            <ol className="duts-sticky__dots">
              {stages.map((stage, i) => (
                <li key={stage.id} data-active={i === active ? "true" : "false"}>
                  {stage.n}
                </li>
              ))}
            </ol>
          </div>

          <div className="duts-sticky__stages">
            {stages.map((stage, i) => (
              <article
                key={stage.id}
                className="duts-sticky__stage"
                data-index={i}
                data-active={i === active ? "true" : "false"}
                ref={(el) => {
                  refs.current[i] = el;
                }}
              >
                <span className="duts-sticky__n">{stage.n}</span>
                <h3>{stage.title}</h3>
                <p>{stage.body}</p>
                <div className="duts-sticky__mobile-card">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={stage.id}
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? undefined : { opacity: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                    >
                      {stage.visual}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default StickyIntelligence;
