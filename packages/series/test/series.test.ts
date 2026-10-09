import { describe, expect, it } from "vitest";
import {
  BlockBuilder,
  Q_BAD,
  Q_GOOD,
  align,
  blockBytes,
  csvLines,
  emptyBlock,
  plotPoints,
  toSeries,
  trimmed,
  windowStats,
  type Series,
} from "../src";

/** Builds blocks of 10,000 like the logger does, then reads them back as one series. */
function series(values: (number | null)[], t0 = 1_760_000_000_000, step = 1000): Series {
  const blocks = [];
  let b = emptyBlock("x", t0);
  let w = new BlockBuilder(b);
  values.forEach((v, i) => {
    if (w.full) {
      blocks.push(trimmed(b));
      b = emptyBlock("x", t0 + i * step);
      w = new BlockBuilder(b);
    }
    w.push(t0 + i * step, v ?? 0, v === null ? Q_BAD : Q_GOOD);
  });
  blocks.push(trimmed(b));
  return toSeries(blocks);
}

describe("blocks", () => {
  it("stores delta times and restores absolute times across blocks", () => {
    const a = emptyBlock("tag", 0, 0, 3);
    const wa = new BlockBuilder(a);
    expect([wa.push(1000, 1, 0), wa.push(2000, 2, 0), wa.push(3500, 3, 0), wa.push(4000, 4, 0)]).toEqual([true, true, true, false]);
    const b = emptyBlock("tag", 0, 0, 3);
    new BlockBuilder(b).push(4000, 4, Q_BAD);
    const s = toSeries([b, a]);
    expect([...s.t]).toEqual([1000, 2000, 3500, 4000]);
    expect(s.v[3]).toBeNaN();
    expect(s.q[3]).toBe(Q_BAD);
  });

  it("treats a clock step backwards as 0 ms", () => {
    const b = emptyBlock("t", 0);
    const w = new BlockBuilder(b);
    w.push(5000, 1, 0);
    w.push(4000, 2, 0);
    expect([...toSeries([trimmed(b)]).t]).toEqual([5000, 5000]);
  });

  it("keeps 7 days x 50 tags at 1 s under 500 MB", () => {
    const perTag = Math.ceil((7 * 24 * 3600) / 10_000);
    const full = { ...emptyBlock("t", 0), n: 10_000 };
    expect(50 * perTag * blockBytes(full)).toBeLessThan(500 * 2 ** 20);
  });
});

describe("windowStats", () => {
  it("computes min, max, mean and std of good samples only", () => {
    const s = series([2, 4, null, 4, 4, 5, 5, 7, 9]);
    expect(windowStats(s)).toEqual({ min: 2, max: 9, mean: 5, std: 2, n: 8, bad: 1 });
  });

  it("restricts to the window", () => {
    const s = series([1, 2, 3, 4, 5]);
    const t0 = s.t[0]!;
    expect(windowStats(s, t0 + 1000, t0 + 3000)).toMatchObject({ min: 2, max: 4, n: 3 });
  });

  it("returns NaN for an empty window", () => {
    expect(windowStats(series([]))).toMatchObject({ n: 0 });
  });
});

describe("plotPoints", () => {
  it("breaks the line on bad samples and long gaps", () => {
    const s = series([1, null, 3]);
    expect(plotPoints(s, { buckets: 100, gapMs: 5000 }).y).toEqual([1, null, 3]);
    const g = toSeries([
      (() => {
        const b = emptyBlock("g", 0);
        const w = new BlockBuilder(b);
        w.push(0, 1, 0);
        w.push(1000, 2, 0);
        w.push(60_000, 3, 0); // the notebook slept
        return trimmed(b);
      })(),
    ]);
    expect(plotPoints(g, { buckets: 100, gapMs: 3000 }).y).toEqual([1, 2, null, 3]);
  });

  it("keeps peaks when decimating 24 h at 1 s to 1000 buckets", () => {
    const values = Array.from({ length: 86_400 }, (_, i) => (i === 43_210 ? 999 : Math.sin(i / 1000)));
    const p = plotPoints(series(values), { buckets: 1000, gapMs: 5000 });
    expect(p.x.length).toBeLessThanOrEqual(2100);
    expect(Math.max(...(p.y.filter((v) => v !== null) as number[]))).toBe(999);
  });

  it("aligns series on a shared x axis", () => {
    const [x, a, b] = align([
      { x: [1, 2], y: [10, 20] },
      { x: [2, 3], y: [200, 300] },
    ]);
    expect(x).toEqual([1, 2, 3]);
    expect(a).toEqual([10, 20, undefined]);
    expect(b).toEqual([undefined, 200, 300]);
  });
});

describe("csvLines", () => {
  it("merges tags by time with ISO timestamps, canonical numbers and quality", () => {
    const a = series([1.5, null], 0);
    const b = series([0.1 + 0.2], 500);
    const lines = [...csvLines([{ id: "a", name: "PT-101" }, { id: "b", name: 'Vazão "bruta"' }], new Map([["a", a], ["b", b]]))];
    expect(lines).toEqual([
      "timestamp,tag,valor,qualidade",
      "1970-01-01T00:00:00.000Z,PT-101,1.5,boa",
      '1970-01-01T00:00:00.500Z,"Vazão ""bruta""",0.30000000000000004,boa',
      "1970-01-01T00:00:01.000Z,PT-101,,ruim",
    ]);
  });
});
