/** Levenshtein distance, used for "did you mean" hints. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }
  return prev[b.length] ?? 0;
}

export function closest(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: { value: string; distance: number } | undefined;
  for (const value of candidates) {
    const distance = editDistance(needle, value.toLowerCase());
    if (!best || distance < best.distance) best = { value, distance };
  }
  const threshold = Math.max(2, Math.floor(needle.length / 3));
  return best && best.distance <= threshold ? best.value : undefined;
}
