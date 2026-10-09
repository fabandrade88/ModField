import { Q_BAD, type Series } from "./block";

export interface Stats {
  min: number;
  max: number;
  mean: number;
  /** Population standard deviation. */
  std: number;
  /** Good samples in the window. */
  n: number;
  /** Bad samples (gaps) in the window. */
  bad: number;
}

/** Statistics of the good samples between from and to (inclusive), Welford's method. */
export function windowStats(s: Series, from = -Infinity, to = Infinity): Stats {
  let n = 0;
  let bad = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i]!;
    if (t < from || t > to) continue;
    const v = s.v[i]!;
    if (s.q[i] === Q_BAD || !Number.isFinite(v)) {
      bad++;
      continue;
    }
    n++;
    const d = v - mean;
    mean += d / n;
    m2 += d * (v - mean);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return n ? { min, max, mean, std: Math.sqrt(m2 / n), n, bad } : { min: NaN, max: NaN, mean: NaN, std: NaN, n: 0, bad };
}
