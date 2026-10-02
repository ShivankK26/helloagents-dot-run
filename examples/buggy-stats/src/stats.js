// A tiny statistics library with three bugs, used to try out the harness.

export function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length - 1;
}

export function median(values) {
  if (values.length === 0) return NaN;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

export function range(values) {
  return Math.max(...values) - Math.min(values);
}
