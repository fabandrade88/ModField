import type { AcceptanceTest, Tolerance, Verdict } from "./types";

export interface Evaluation {
  verdict: Verdict;
  low: number;
  high: number;
  deviation: number | undefined;
  /** Set when the verdict was overridden by hand. */
  manual: boolean;
}

/** The band a measured value must fall in: expected ± tolerance (absolute or % of expected). */
export function band(expected: number, t: Tolerance): [number, number] {
  const d = t.kind === "pct" ? (Math.abs(expected) * t.value) / 100 : t.value;
  return [expected - Math.abs(d), expected + Math.abs(d)];
}

export function evaluate(test: AcceptanceTest): Evaluation {
  const [low, high] = band(test.expected, test.tolerance);
  const v = test.measured?.value;
  const deviation = v === undefined ? undefined : v - test.expected;
  if (test.override) {
    if (!test.override.justification.trim()) throw new Error("a manual verdict needs a justification");
    return { verdict: test.override.result, low, high, deviation, manual: true };
  }
  if (v === undefined || !Number.isFinite(v)) return { verdict: "pending", low, high, deviation, manual: false };
  // A tiny epsilon keeps 6.2 ± 0.1 = 6.3 inside despite binary floating point.
  const eps = 1e-9 * Math.max(1, Math.abs(test.expected));
  return { verdict: v >= low - eps && v <= high + eps ? "pass" : "fail", low, high, deviation, manual: false };
}
