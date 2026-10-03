export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  lines: string[];
}

/** Splits `git diff` output into files. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = / b\/(.+)$/.exec(line)?.[1] ?? line;
      current = { path, added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line))
      continue;
    if (line.startsWith("+")) current.added++;
    else if (line.startsWith("-")) current.removed++;
    current.lines.push(line);
  }
  return files;
}
