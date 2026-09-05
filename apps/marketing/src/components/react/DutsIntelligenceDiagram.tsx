import { motion } from "framer-motion";
import { EASE, VIEWPORT_WIDE, fadeUp, staggerContainer } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

const VB_W = 900;
const VB_H = 520;
const CORE = { x: 360, y: 260, r: 66 };
const KNOWLEDGE_X = 210;
const NODE_X = 560;

const KNOWLEDGE = ["Services & pricing", "Policies & FAQs", "Documents", "Past conversations"];

const NODES = [
  { name: "Website", caption: "Chat, capture, answers" },
  { name: "WhatsApp", caption: "Conversations that convert" },
  { name: "Email", caption: "Understood and answered" },
  { name: "Documents", caption: "Read, extract, summarize" },
  { name: "CRM", caption: "Records kept up to date" },
  { name: "Calls", caption: "Nothing gets lost" },
  { name: "Customers", caption: "Answered in seconds" },
  { name: "Employees", caption: "Instant internal answers" }
];

const OUTCOMES = ["Answer", "Qualify", "Book", "Create", "Automate", "Analyze"];

function distribute(count: number, from: number, to: number): number[] {
  if (count < 2) return [(from + to) / 2];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

function arcPoint(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CORE.x + CORE.r * Math.cos(rad), y: CORE.y - CORE.r * Math.sin(rad) };
}

const NODE_YS = distribute(NODES.length, 42, 478);

const NODE_PATHS = NODE_YS.map((y, i) => {
  const t = NODES.length < 2 ? 0.5 : i / (NODES.length - 1);
  const start = arcPoint(80 - 160 * t);
  const run = 74;
  return `M ${start.x} ${start.y} C ${start.x + run} ${start.y}, ${NODE_X - run} ${y}, ${NODE_X} ${y}`;
});

const KNOWLEDGE_PATH = `M ${KNOWLEDGE_X} ${CORE.y} C ${KNOWLEDGE_X + 30} ${CORE.y}, ${CORE.x - CORE.r - 30} ${CORE.y}, ${CORE.x - CORE.r} ${CORE.y}`;

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

type DutsIntelligenceDiagramProps = {
  eyebrow?: string;
  title?: string;
  lead?: string;
};

function CoreBadge({ reduced }: { reduced: boolean }) {
  return (
    <div className="duts-diagram__core">
      <motion.span
        className="duts-diagram__core-ring"
        animate={reduced ? undefined : { rotate: -360 }}
        transition={reduced ? undefined : { duration: 24, repeat: Infinity, ease: "linear" }}
      />
      <span className="duts-diagram__core-face">
        <span className="duts-diagram__core-mark">DUTS AI</span>
        <span className="duts-diagram__core-sub">Intelligence layer</span>
      </span>
    </div>
  );
}

function KnowledgePanel() {
  return (
    <div className="duts-diagram__knowledge">
      <span className="duts-diagram__knowledge-title">Business Knowledge</span>
      <ul className="duts-diagram__knowledge-list">
        {KNOWLEDGE.map((item) => (
          <li key={item}>
            <span className="duts-diagram__tick" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DutsIntelligenceDiagram({
  eyebrow = "The DUTS layer",
  title = "One intelligence layer. Across your business.",
  lead = "Your business knowledge powers a single AI layer that plugs into the channels, systems and people you already work with — so every touchpoint gets the same accurate answer."
}: DutsIntelligenceDiagramProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="duts-section duts-diagram" aria-labelledby="duts-diagram-title">
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
          <motion.h2 className="duts-section__title" id="duts-diagram-title" variants={fadeUp(reduced)}>
            {title}
          </motion.h2>
          <motion.p className="duts-section__lead" variants={fadeUp(reduced)}>
            {lead}
          </motion.p>
        </motion.header>

        <div className="duts-diagram__stage" aria-hidden="true">
          <svg
            className="duts-diagram__wires"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            fill="none"
            role="presentation"
            focusable="false"
          >
            <defs>
              <linearGradient id="dutsDiagramIn" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="dutsDiagramOut" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.35" />
              </linearGradient>
              <radialGradient id="dutsDiagramGlow">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx={CORE.x} cy={CORE.y} r={180} fill="url(#dutsDiagramGlow)" />

            <motion.path
              d={KNOWLEDGE_PATH}
              stroke="url(#dutsDiagramIn)"
              strokeWidth={2}
              strokeLinecap="round"
              initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={reduced ? { duration: 0 } : { duration: 0.7, ease: EASE }}
            />

            {NODE_PATHS.map((d, i) => (
              <g key={`wire-${i}`}>
                <path d={d} className="duts-diagram__wire-base" />
                <motion.path
                  d={d}
                  stroke="url(#dutsDiagramOut)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={
                    reduced ? { duration: 0 } : { duration: 0.9, delay: 0.35 + i * 0.08, ease: EASE }
                  }
                />
              </g>
            ))}

            {NODE_YS.map((y, i) => (
              <circle key={`node-dot-${i}`} cx={NODE_X} cy={y} r={3.2} className="duts-diagram__dot" />
            ))}
            <circle cx={KNOWLEDGE_X} cy={CORE.y} r={3.2} className="duts-diagram__dot" />
          </svg>

          <div
            className="duts-diagram__slot duts-diagram__slot--knowledge"
            style={{ width: pct(KNOWLEDGE_X, VB_W), top: pct(CORE.y, VB_H) }}
          >
            <KnowledgePanel />
          </div>

          <div
            className="duts-diagram__slot duts-diagram__slot--core"
            style={{ left: pct(CORE.x, VB_W), top: pct(CORE.y, VB_H), width: pct(CORE.r * 2, VB_W) }}
          >
            <CoreBadge reduced={reduced} />
          </div>

          {NODES.map((node, i) => (
            <motion.div
              key={node.name}
              className="duts-diagram__slot duts-diagram__slot--node"
              style={{ left: pct(NODE_X, VB_W), top: pct(NODE_YS[i], VB_H) }}
              initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : 14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, delay: 0.5 + i * 0.08, ease: EASE }}
            >
              <span className="duts-diagram__node">
                <span className="duts-diagram__node-name">{node.name}</span>
                <span className="duts-diagram__node-caption">{node.caption}</span>
              </span>
            </motion.div>
          ))}
        </div>

        <div className="duts-diagram__flow">
          <KnowledgePanel />
          <span className="duts-diagram__flow-arrow" aria-hidden="true" />
          <CoreBadge reduced={reduced} />
          <span className="duts-diagram__flow-arrow" aria-hidden="true" />
          <div className="duts-diagram__flow-nodes">
            {NODES.map((node) => (
              <span className="duts-diagram__node" key={node.name}>
                <span className="duts-diagram__node-name">{node.name}</span>
                <span className="duts-diagram__node-caption">{node.caption}</span>
              </span>
            ))}
          </div>
        </div>

        <motion.div
          className="duts-diagram__outcomes"
          variants={staggerContainer(reduced, 0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.5 }}
        >
          <span className="duts-diagram__outcomes-label">Outcomes</span>
          <div className="duts-diagram__outcomes-row">
            {OUTCOMES.map((outcome) => (
              <motion.span className="duts-outcome" key={outcome} variants={fadeUp(reduced, 12, 0.45)}>
                {outcome}
              </motion.span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export { DutsIntelligenceDiagram };
