import { motion } from "framer-motion";
import { EASE } from "./anim";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import "../../styles/home.css";

/**
 * Every coordinate below lives in the SVG viewBox space. The stage element is
 * locked to the same aspect ratio, so chips positioned with percentages land
 * exactly on the endpoints of the connector paths.
 */
const VB_W = 640;
const VB_H = 440;
const CORE = { x: 320, y: 220, r: 62 };
const IN_X = 192;
const OUT_X = 448;
const CONTROL_RUN = 48;

const INPUTS = [
  "Customer Message",
  "Website Lead",
  "Phone Call",
  "Document",
  "Email",
  "WhatsApp"
];

const OUTPUTS = [
  "Lead Qualified",
  "Appointment Booked",
  "Customer Answered",
  "Quote Created",
  "Task Automated"
];

type Point = { x: number; y: number };
type Link = { label: string; d: string; anchor: Point };

function distribute(count: number, from: number, to: number): number[] {
  if (count < 2) return [(from + to) / 2];
  return Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
}

/** Point on the core circle, measured in degrees counter-clockwise from east. */
function arcPoint(angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CORE.x + CORE.r * Math.cos(rad),
    y: CORE.y - CORE.r * Math.sin(rad)
  };
}

function buildLinks(labels: string[], side: "in" | "out"): Link[] {
  const anchorX = side === "in" ? IN_X : OUT_X;
  const spread = side === "in" ? distribute(labels.length, 58, 382) : distribute(labels.length, 84, 356);

  return labels.map((label, i) => {
    const t = labels.length < 2 ? 0.5 : i / (labels.length - 1);
    // Inputs fan into the left arc (150deg -> 210deg), outputs leave the right arc (30deg -> -30deg).
    const core = side === "in" ? arcPoint(150 + 60 * t) : arcPoint(30 - 60 * t);
    const anchor = { x: anchorX, y: spread[i] ?? CORE.y };

    const d =
      side === "in"
        ? `M ${anchor.x} ${anchor.y} C ${anchor.x + CONTROL_RUN} ${anchor.y}, ${core.x - CONTROL_RUN} ${core.y}, ${core.x} ${core.y}`
        : `M ${core.x} ${core.y} C ${core.x + CONTROL_RUN} ${core.y}, ${anchor.x - CONTROL_RUN} ${anchor.y}, ${anchor.x} ${anchor.y}`;

    return { label, d, anchor };
  });
}

const INPUT_LINKS = buildLinks(INPUTS, "in");
const OUTPUT_LINKS = buildLinks(OUTPUTS, "out");

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

function SignalCore({ reduced }: { reduced: boolean }) {
  return (
    <div className="duts-signal__core">
      <motion.span
        className="duts-signal__core-ring"
        animate={reduced ? undefined : { rotate: 360 }}
        transition={reduced ? undefined : { duration: 18, repeat: Infinity, ease: "linear" }}
      />
      <span className="duts-signal__core-halo" data-reduced={reduced ? "true" : "false"} />
      <span className="duts-signal__core-halo duts-signal__core-halo--delayed" data-reduced={reduced ? "true" : "false"} />
      <span className="duts-signal__core-face">
        <span className="duts-signal__core-mark">DUTS</span>
        <span className="duts-signal__core-sub">AI</span>
      </span>
    </div>
  );
}

export default function BusinessSignalAnimation() {
  const reduced = usePrefersReducedMotion();

  return (
    <div className="duts-signal" aria-hidden="true">
      <div className="duts-signal__stage">
        <svg
          className="duts-signal__wires"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          fill="none"
          role="presentation"
          focusable="false"
        >
          <defs>
            <linearGradient id="dutsWireIn" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="45%" stopColor="#22d3ee" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="dutsWireOut" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="dutsCoreGlow">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.28" />
              <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={CORE.x} cy={CORE.y} r={168} fill="url(#dutsCoreGlow)" />

          {[...INPUT_LINKS, ...OUTPUT_LINKS].map((link, i) => (
            <path key={`base-${i}`} d={link.d} className="duts-signal__wire-base" />
          ))}

          {!reduced &&
            INPUT_LINKS.map((link, i) => (
              <motion.path
                key={`pulse-in-${i}`}
                d={link.d}
                stroke="url(#dutsWireIn)"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeDasharray="26 268"
                initial={{ strokeDashoffset: 294 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{
                  duration: 2.8,
                  delay: i * 0.34,
                  repeat: Infinity,
                  repeatDelay: 0.5,
                  ease: "linear"
                }}
              />
            ))}

          {!reduced &&
            OUTPUT_LINKS.map((link, i) => (
              <motion.path
                key={`pulse-out-${i}`}
                d={link.d}
                stroke="url(#dutsWireOut)"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeDasharray="26 268"
                initial={{ strokeDashoffset: 294 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{
                  duration: 2.8,
                  delay: 1.1 + i * 0.34,
                  repeat: Infinity,
                  repeatDelay: 0.5,
                  ease: "linear"
                }}
              />
            ))}

          {INPUT_LINKS.map((link, i) => (
            <circle key={`dot-in-${i}`} cx={link.anchor.x} cy={link.anchor.y} r={3} className="duts-signal__node" />
          ))}
          {OUTPUT_LINKS.map((link, i) => (
            <circle key={`dot-out-${i}`} cx={link.anchor.x} cy={link.anchor.y} r={3} className="duts-signal__node" />
          ))}
        </svg>

        {INPUT_LINKS.map(({ label, anchor }, i) => (
          <span
            key={label}
            className="duts-signal__slot duts-signal__slot--in"
            style={{
              top: pct(anchor.y, VB_H),
              right: pct(VB_W - IN_X, VB_W)
            }}
          >
            <motion.span
              className="duts-signal__chip duts-signal__chip--in"
              style={{ animationDelay: `${i * 0.42}s` }}
              data-reduced={reduced ? "true" : "false"}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.55, delay: 0.15 + i * 0.09, ease: EASE }}
            >
              <span className="duts-signal__chip-dot" />
              {label}
            </motion.span>
          </span>
        ))}

        {OUTPUT_LINKS.map(({ label, anchor }, i) => (
          <span
            key={label}
            className="duts-signal__slot duts-signal__slot--out"
            style={{
              top: pct(anchor.y, VB_H),
              left: pct(OUT_X, VB_W)
            }}
          >
            <motion.span
              className="duts-signal__chip duts-signal__chip--out"
              style={{ animationDelay: `${0.6 + i * 0.42}s` }}
              data-reduced={reduced ? "true" : "false"}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.55, delay: 0.5 + i * 0.09, ease: EASE }}
            >
              <span className="duts-signal__chip-dot duts-signal__chip-dot--out" />
              {label}
            </motion.span>
          </span>
        ))}

        <div className="duts-signal__core-slot">
          <SignalCore reduced={reduced} />
        </div>
      </div>

      <div className="duts-signal__compact">
        <SignalCore reduced={reduced} />

        <div className="duts-signal__rails">
          <div className="duts-signal__rail" data-dir="left" data-reduced={reduced ? "true" : "false"}>
            <div className="duts-signal__rail-track">
              {[...INPUTS, ...INPUTS].map((label, i) => (
                <span className="duts-signal__chip duts-signal__chip--static" key={`ri-${i}`}>
                  <span className="duts-signal__chip-dot" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="duts-signal__rail" data-dir="right" data-reduced={reduced ? "true" : "false"}>
            <div className="duts-signal__rail-track">
              {[...OUTPUTS, ...OUTPUTS].map((label, i) => (
                <span className="duts-signal__chip duts-signal__chip--static" key={`ro-${i}`}>
                  <span className="duts-signal__chip-dot duts-signal__chip-dot--out" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { BusinessSignalAnimation };
