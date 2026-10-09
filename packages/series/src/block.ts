/** Sample quality: 0 good, 1 uncertain, 2 bad (gap, timeout, error). */
export const Q_GOOD = 0;
export const Q_UNCERTAIN = 1;
export const Q_BAD = 2;
export type Quality = 0 | 1 | 2;

export const BLOCK_SIZE = 10_000;

/**
 * Up to 10,000 samples of one tag, in typed arrays: about 13 bytes per sample
 * (4 dt + 8 value + 1 quality), against 50-100 bytes as objects.
 */
export interface SampleBlock {
  tagId: string;
  /** Epoch ms, UTC, of the first sample. */
  t0: number;
  /** Sequence of the first sample when it came from the agent, else 0. */
  seq0: number;
  n: number;
  /** ms from the previous sample (dt[0] = 0). */
  dt: Uint32Array;
  /** Engineering value; NaN when bad. */
  v: Float64Array;
  q: Uint8Array;
}

export function emptyBlock(tagId: string, t0: number, seq0 = 0, capacity = BLOCK_SIZE): SampleBlock {
  return { tagId, t0, seq0, n: 0, dt: new Uint32Array(capacity), v: new Float64Array(capacity), q: new Uint8Array(capacity) };
}

/** Time of the last sample. */
export function lastTime(b: SampleBlock): number {
  let t = b.t0;
  for (let i = 1; i < b.n; i++) t += b.dt[i]!;
  return t;
}

/** Appends a sample; returns false when the block is full. Clock steps backwards count as 0 ms. */
export class BlockBuilder {
  private last: number;

  constructor(readonly block: SampleBlock) {
    this.last = block.n ? lastTime(block) : block.t0;
  }

  get full(): boolean {
    return this.block.n >= this.block.dt.length;
  }

  push(t: number, v: number, q: Quality): boolean {
    const b = this.block;
    if (this.full) return false;
    const i = b.n;
    b.dt[i] = i === 0 ? 0 : Math.max(0, Math.min(0xffffffff, Math.round(t - this.last)));
    if (i === 0) b.t0 = t;
    b.v[i] = q === Q_BAD ? Number.NaN : v;
    b.q[i] = q;
    b.n++;
    this.last = i === 0 ? t : this.last + b.dt[i]!;
    return true;
  }
}

/** Copy trimmed to n, for storage. */
export function trimmed(b: SampleBlock): SampleBlock {
  return { ...b, dt: b.dt.slice(0, b.n), v: b.v.slice(0, b.n), q: b.q.slice(0, b.n) };
}

export interface Series {
  t: Float64Array;
  v: Float64Array;
  q: Uint8Array;
}

/** Concatenates blocks of one tag, sorted by t0. */
export function toSeries(blocks: SampleBlock[]): Series {
  const sorted = [...blocks].sort((a, b) => a.t0 - b.t0);
  const n = sorted.reduce((s, b) => s + b.n, 0);
  const out: Series = { t: new Float64Array(n), v: new Float64Array(n), q: new Uint8Array(n) };
  let k = 0;
  for (const b of sorted) {
    let t = b.t0;
    for (let i = 0; i < b.n; i++, k++) {
      t += i === 0 ? 0 : b.dt[i]!;
      out.t[k] = t;
      out.v[k] = b.v[i]!;
      out.q[k] = b.q[i]!;
    }
  }
  return out;
}

export function blockBytes(b: SampleBlock): number {
  return b.n * 13 + 64;
}
