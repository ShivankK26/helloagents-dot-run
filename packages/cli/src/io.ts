import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";

/** Everything the CLI touches in the outside world, injectable for tests. */
export interface Io {
  cwd: string;
  home: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  out: (text: string) => void;
  err: (text: string) => void;
  /** True when we can ask the user questions. */
  interactive: boolean;
  confirm: (question: string) => Promise<boolean>;
  color: boolean;
  columns: number;
}

export function processIo(): Io {
  const { env, stdin, stdout, stderr } = process;
  const color = env.FORCE_COLOR
    ? env.FORCE_COLOR !== "0"
    : Boolean(stdout.isTTY) && !env.NO_COLOR && env.TERM !== "dumb";
  return {
    cwd: process.cwd(),
    home: homedir(),
    env,
    fetch: globalThis.fetch,
    out: (text) => stdout.write(`${text}\n`),
    err: (text) => stderr.write(`${text}\n`),
    interactive: Boolean(stdin.isTTY && stdout.isTTY),
    confirm: async (question) => {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        const answer = await rl.question(`${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
    color,
    columns: stdout.columns || 80,
  };
}
