import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { type PointerEvent, useEffect, useRef } from "react";
import { Icon } from "./Icons";

/**
 * One shell per folder, kept alive while the app is open: closing the drawer or
 * switching tabs only hides it, so a running server or a half-typed command stays.
 */
interface Session {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  id?: string;
  ended: boolean;
}
const sessions = new Map<string, Session>();
const byId = new Map<string, Session>();
/** Output that arrived before we knew which shell it's from. */
const unclaimed = new Map<string, string[]>();
let listening = false;

const DARK: ITheme = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#ff7a3d",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(255, 122, 61, 0.3)",
};
const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#171717",
  cursor: "#e4572a",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(228, 87, 42, 0.2)",
  // xterm's defaults are made for dark backgrounds; these stay readable on white.
  black: "#171717",
  white: "#737373",
  brightWhite: "#404040",
  yellow: "#a16207",
  brightYellow: "#854d0e",
  green: "#15803d",
  brightGreen: "#166534",
  cyan: "#0e7490",
  brightCyan: "#155e75",
};

function listen(): void {
  if (listening) return;
  listening = true;
  const api = window.helloagents;
  api.onTermData((id, data) => {
    const s = byId.get(id);
    if (s) s.term.write(data);
    else unclaimed.set(id, [...(unclaimed.get(id) ?? []), data]);
  });
  api.onTermExit((id) => {
    const s = byId.get(id);
    if (!s) return;
    byId.delete(id);
    s.id = undefined;
    s.ended = true;
    s.term.write("\r\n\x1b[2m[Shell ended · press any key for a new one]\x1b[0m\r\n");
  });
}

function startShell(s: Session, cwds: string[]): void {
  s.ended = false;
  void window.helloagents.termStart(cwds, s.term.cols, s.term.rows).then((id) => {
    s.id = id;
    byId.set(id, s);
    for (const data of unclaimed.get(id) ?? []) s.term.write(data);
    unclaimed.delete(id);
  });
}

function session(cwd: string, cwds: string[], dark: boolean): Session {
  const existing = sessions.get(cwd);
  if (existing) return existing;
  listen();
  const host = document.createElement("div");
  host.className = "term-host";
  const term = new Terminal({
    fontFamily: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12.5,
    lineHeight: 1.25,
    cursorBlink: true,
    macOptionIsMeta: true,
    scrollback: 5000,
    theme: dark ? DARK : LIGHT,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // The app's own shortcuts (⌃` and ⌘ keys) aren't for the shell.
  term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.key === "`") && !e.metaKey);
  const s: Session = { term, fit, host, ended: false };
  term.onData((data) => {
    if (s.ended) startShell(s, cwds);
    else if (s.id) window.helloagents.termWrite(s.id, data);
  });
  sessions.set(cwd, s);
  return s;
}

/** The terminal drawer under the main area, in the current run's (or project's) folder. */
export function TerminalDrawer({
  cwd,
  fallback,
  label,
  dark,
  height,
  onHeight,
  onClose,
}: {
  cwd: string;
  /** Where to start if `cwd` is gone (a shipped run's folder): the project. */
  fallback: string;
  label: string;
  dark: boolean;
  height: number;
  onHeight: (h: number) => void;
  onClose: () => void;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const s = session(cwd, [cwd, fallback], dark);
    el.replaceChildren(s.host);
    if (!s.term.element) s.term.open(s.host);
    const resize = () => {
      if (!el.isConnected || !el.clientHeight) return;
      s.fit.fit();
      if (s.id) window.helloagents.termResize(s.id, s.term.cols, s.term.rows);
    };
    resize();
    if (!s.id && !s.ended) startShell(s, [cwd, fallback]);
    s.term.refresh(0, s.term.rows - 1);
    s.term.focus();
    const watch = new ResizeObserver(resize);
    watch.observe(el);
    return () => watch.disconnect();
    // The theme is applied separately, without moving the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    for (const s of sessions.values()) s.term.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  const restart = () => {
    const s = sessions.get(cwd);
    if (!s) return;
    if (s.id) {
      byId.delete(s.id);
      window.helloagents.termKill(s.id);
      s.id = undefined;
    }
    s.term.reset();
    startShell(s, [cwd, fallback]);
    s.term.focus();
  };

  // Drag the top edge to make it taller or shorter.
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    document.body.classList.add("resizing");
    const max = () => Math.round(window.innerHeight * 0.75);
    const move = (ev: globalThis.PointerEvent) =>
      onHeight(Math.min(Math.max(120, startH - (ev.clientY - startY)), max()));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      sessions.get(cwd)?.term.focus();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <section className="term-drawer" style={{ height }} aria-label="Terminal">
      <div className="box-grip top" title="Drag to resize" onPointerDown={drag} />
      <header className="term-head">
        <Icon name="term" size={14} />
        <span className="term-title">Terminal</span>
        <span className="term-where" title={cwd}>
          {label}
        </span>
        <span className="grow" />
        <button className="icon-btn sm" onClick={restart} title="New shell" aria-label="New shell">
          <Icon name="resume" size={13} />
        </button>
        <button
          className="icon-btn sm"
          onClick={onClose}
          title="Hide (⌃`)"
          aria-label="Hide the terminal"
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      <div className="term-body" ref={body} />
    </section>
  );
}
