export interface Toast {
  id: number;
  message: string;
  tone: "ok" | "bad" | "info";
  url?: string;
}

type Listener = (toasts: Toast[]) => void;
let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(toasts));

/** Shows a short message in the corner for a few seconds. */
export function showToast(
  message: string,
  opts: { tone?: Toast["tone"]; url?: string } = {},
): void {
  const t: Toast = {
    id: next++,
    message,
    tone: opts.tone ?? "info",
    ...(opts.url && { url: opts.url }),
  };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), opts.url ? 9000 : 4500);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(toasts);
  return () => listeners.delete(l);
}

/** Error text without Electron's "Error invoking remote method …" prefix. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
