import type { Table } from "./address";
import { LIMITS } from "./codes";
import { decodeValue, registerCount, toEngineering, type ByteOrder, type DataType, type LinearScale } from "./datatypes";

/** A named point in a device's register map, with type, scale and unit. */
export interface TagDef {
  id: string;
  name: string;
  unitId: number;
  table: Table;
  /** Protocol offset, 0..65535. */
  offset: number;
  /** Ignored for coils and discrete inputs. */
  type: DataType;
  order: ByteOrder;
  stringLength?: number;
  scale?: LinearScale;
  unit?: string;
  decimals?: number;
  description?: string;
}

export const isBitTable = (t: Table) => t === "coil" || t === "discrete";

export function tagWidth(tag: Pick<TagDef, "table" | "type" | "stringLength">): number {
  return isBitTable(tag.table) ? 1 : registerCount(tag.type, tag.stringLength ?? 0);
}

export interface ReadBlock {
  unitId: number;
  table: Table;
  offset: number;
  quantity: number;
  tags: TagDef[];
}

export interface PlanOptions {
  /** Largest hole (registers or bits) worth reading through to save a request. */
  maxGap?: number;
  maxRegisters?: number;
  maxBits?: number;
}

/**
 * Groups tags of the same slave and table into as few requests as possible.
 * Reading a few unused registers in a gap is cheaper than a new transaction:
 * at 9600 baud each request costs ~20 ms of wire time plus turnaround.
 */
export function planReads(tags: readonly TagDef[], opts: PlanOptions = {}): ReadBlock[] {
  const maxGap = opts.maxGap ?? 8;
  const groups = new Map<string, TagDef[]>();
  for (const t of tags) {
    const key = `${t.unitId}:${t.table}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const blocks: ReadBlock[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const limit = isBitTable(first.table) ? (opts.maxBits ?? LIMITS.maxReadBits) : (opts.maxRegisters ?? LIMITS.maxReadRegisters);
    const sorted = [...group].sort((a, b) => a.offset - b.offset);
    let cur: ReadBlock | undefined;
    for (const t of sorted) {
      const end = t.offset + tagWidth(t);
      if (cur && t.offset - (cur.offset + cur.quantity) <= maxGap && end - cur.offset <= limit) {
        cur.quantity = Math.max(cur.quantity, end - cur.offset);
        cur.tags.push(t);
      } else {
        cur = { unitId: t.unitId, table: t.table, offset: t.offset, quantity: tagWidth(t), tags: [t] };
        blocks.push(cur);
      }
    }
  }
  return blocks;
}

export interface TagValue {
  /** Engineering value (scaled) or text for strings. */
  value: number | string;
  raw: number[];
}

/**
 * Smaller blocks to retry when a merged block is refused: first the gapless
 * runs, then one block per tag. Many devices answer exception 02 when a read
 * spans an unmapped hole, even if every tag inside it exists.
 */
export function splitBlock(block: ReadBlock): ReadBlock[] {
  if (block.tags.length < 2) return [block];
  const runs = planReads(block.tags, { maxGap: 0 });
  if (runs.length > 1) return runs;
  return block.tags.map((t) => ({ unitId: t.unitId, table: t.table, offset: t.offset, quantity: tagWidth(t), tags: [t] }));
}

/** Decodes every tag of a block from the registers (or 0/1 bits) the block returned. */
export function decodeBlock(block: ReadBlock, words: readonly number[]): Map<string, TagValue> {
  const out = new Map<string, TagValue>();
  for (const t of block.tags) {
    const start = t.offset - block.offset;
    const raw = words.slice(start, start + tagWidth(t));
    if (isBitTable(t.table)) {
      out.set(t.id, { value: raw[0] ? 1 : 0, raw });
      continue;
    }
    const v = decodeValue(raw, t.type, t.order);
    out.set(t.id, { value: typeof v === "number" && t.scale ? toEngineering(v, t.scale) : v, raw });
  }
  return out;
}

/** "12.35 bar"; strings as-is. */
export function formatTagValue(tag: Pick<TagDef, "decimals" | "unit">, value: number | string | undefined): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  // Without configured decimals: 6 significant digits, no trailing zeros (7.5, not 7.50000).
  const n = tag.decimals === undefined ? String(Number(value.toPrecision(6))) : value.toFixed(tag.decimals);
  return tag.unit ? `${n} ${tag.unit}` : n;
}
