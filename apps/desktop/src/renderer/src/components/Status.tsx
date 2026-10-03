const LABEL: Record<string, string> = {
  running: "Working",
  done: "Done",
  error: "Failed",
  cancelled: "Stopped",
  budget: "Hit a limit",
  refused: "Declined",
  context_full: "Ran out of context",
};

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "live"
      : status === "done"
        ? "ok"
        : status === "cancelled"
          ? "muted"
          : "bad";
  return <span className={`pill ${tone}`}>{LABEL[status] ?? status}</span>;
}

export function StatusDot({ status }: { status: string }) {
  const tone =
    status === "running" ? "live" : status === "done" ? "ok" : status === "cancelled" ? "" : "bad";
  return <span className={`dot ${tone}`} aria-hidden="true" />;
}
