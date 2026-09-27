export interface Style {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
}

const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;

export function createStyle(enabled: boolean): Style {
  if (!enabled) {
    const id = (s: string) => s;
    return { bold: id, dim: id, red: id, green: id, yellow: id, cyan: id };
  }
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}

/** An error whose message is safe and helpful to show as-is. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function truncate(text: string, width: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (width <= 1) return "";
  return oneLine.length <= width ? oneLine : `${oneLine.slice(0, width - 1).trimEnd()}…`;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
