import { Q_BAD, type Series } from "./block";

/** First index i with t[i] >= target (t is sorted ascending); t.length if none. */
export function lowerBound(t: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index i with t[i] > target (t is sorted ascending); t.length if none. */
export function upperBound(t: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Plot {
  /** Seconds (uPlot's x unit). */
  x: number[];
  /** null breaks the line: bad samples and time gaps. */
  y: (number | null)[];
}

/**
 * Points for the chart between from and to, at most ~2 per pixel bucket
 * (min and max of each bucket, so peaks survive). Gaps longer than gapMs and
 * bad samples become null, so the line breaks instead of bridging a gap.
 */
export function plotPoints(s: Series, opts: { from?: number; to?: number; buckets: number; gapMs: number }): Plot {
  const from = opts.from ?? -Infinity;
  const to = opts.to ?? Infinity;
  // s.t is sorted ascending: binary-search the window bounds instead of walking
  // the whole series on every redraw (O(log n) vs O(n) as a session grows).
  const lo = lowerBound(s.t, from);
  const hi = upperBound(s.t, to) - 1;
  const x: number[] = [];
  const y: (number | null)[] = [];
  const count = hi - lo + 1;
  if (count <= 0) return { x, y };

  const point = (i: number, gapBefore: boolean) => {
    if (gapBefore) {
      x.push((s.t[i]! - 1) / 1000);
      y.push(null);
    }
    x.push(s.t[i]! / 1000);
    y.push(s.q[i] === Q_BAD || !Number.isFinite(s.v[i]!) ? null : s.v[i]!);
  };

  if (count <= opts.buckets * 2) {
    for (let i = lo; i <= hi; i++) point(i, i > lo && s.t[i]! - s.t[i - 1]! > opts.gapMs);
    return { x, y };
  }
  const span = s.t[hi]! - s.t[lo]!;
  const width = span / opts.buckets;
  let i = lo;
  for (let b = 0; b < opts.buckets && i <= hi; b++) {
    const end = s.t[lo]! + (b + 1) * width;
    let iMin = -1;
    let iMax = -1;
    let hasBad = false;
    const start = i;
    for (; i <= hi && (s.t[i]! <= end || b === opts.buckets - 1); i++) {
      const v = s.v[i]!;
      if (s.q[i] === Q_BAD || !Number.isFinite(v)) {
        hasBad = true;
        continue;
      }
      if (iMin < 0 || v < s.v[iMin]!) iMin = i;
      if (iMax < 0 || v > s.v[iMax]!) iMax = i;
    }
    if (i === start) continue;
    const gap = start > lo && s.t[start]! - s.t[start - 1]! > opts.gapMs;
    if (iMin < 0) {
      // Only bad samples in this bucket.
      x.push(s.t[start]! / 1000);
      y.push(null);
      continue;
    }
    const [a, c] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
    point(a, gap);
    if (c !== a) point(c, false);
    if (hasBad) {
      x.push(s.t[i - 1]! / 1000);
      y.push(null);
    }
  }
  return { x, y };
}

/** Merges several series on one x axis (uPlot wants aligned data). */
export function align(plots: Plot[]): [number[], ...(number | null)[][]] {
  const xs = [...new Set(plots.flatMap((p) => p.x))].sort((a, b) => a - b);
  const index = new Map(xs.map((x, i) => [x, i]));
  const ys = plots.map((p) => {
    const col = new Array<number | null>(xs.length).fill(undefined as unknown as null);
    p.x.forEach((x, i) => (col[index.get(x)!] = p.y[i]!));
    return col;
  });
  return [xs, ...ys];
}
