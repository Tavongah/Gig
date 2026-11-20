type ConfirmHandler = () => Promise<boolean>;

let handler: ConfirmHandler | null = null;
let inflight = false;

export function registerWebCartConfirm(next: ConfirmHandler | null) {
  handler = next;
}

/** Website-only prompt. Returns false when dismissed or when no prompt is mounted, and never replaces the cart itself. */
export function requestNewCartConfirm(): Promise<boolean> {
  if (inflight || !handler) return Promise.resolve(false);
  inflight = true;
  return handler().finally(() => {
    inflight = false;
  });
}
