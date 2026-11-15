import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function mountSearchOverlay(node: ReactNode) {
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
