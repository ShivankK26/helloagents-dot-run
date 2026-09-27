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

/** Names that are a plausible typo of, or contain, `input`, closest first. */
export function suggest(input: string, names: readonly string[], limit = 3): string[] {
  const needle = input.toLowerCase();
  const threshold = Math.max(2, Math.floor(needle.length / 3));
  return names
    .map((name) => {
      const distance = editDistance(needle, name);
      const contains = needle.length >= 3 && (name.includes(needle) || needle.includes(name));
      return { name, score: contains ? Math.min(distance, 1) : distance };
    })
    .filter((c) => c.score <= threshold)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => c.name);
}
