import { Q_BAD, Q_UNCERTAIN, type Series } from "./block";

export interface CsvTag {
  id: string;
  name: string;
}

const QUALITY = ["boa", "incerta", "ruim"] as const;

/**
 * Session CSV: timestamp ISO 8601 (UTC), tag, valor, qualidade; ordered by
 * time, then by the tag order given. The same bytes feed the report hash,
 * so the order and number formatting are fixed (canonical).
 */
export function* csvLines(tags: CsvTag[], series: Map<string, Series>): Generator<string> {
  yield "timestamp,tag,valor,qualidade";
  const cursors = tags.map((tag) => ({ tag, s: series.get(tag.id), i: 0 }));
  for (;;) {
    let best = -1;
    let bestT = Infinity;
    cursors.forEach((c, k) => {
      if (c.s && c.i < c.s.t.length && c.s.t[c.i]! < bestT) {
        bestT = c.s.t[c.i]!;
        best = k;
      }
    });
    if (best < 0) return;
    const c = cursors[best]!;
    const s = c.s!;
    const q = s.q[c.i]!;
    const v = s.v[c.i]!;
    yield `${new Date(bestT).toISOString()},${csvField(c.tag.name)},${q === Q_BAD || !Number.isFinite(v) ? "" : canonicalNumber(v)},${QUALITY[q === Q_UNCERTAIN ? 1 : q === Q_BAD ? 2 : 0]}`;
    c.i++;
  }
}

/** Shortest round-trip decimal; never exponent notation, so spreadsheets read it. */
export function canonicalNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = String(v);
  return s.includes("e") ? v.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
