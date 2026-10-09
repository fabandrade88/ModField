"use client";
import { decodeBlock, type ReadBlock, type TagDef } from "@modfield/protocol";
import { BlockBuilder, Q_BAD, Q_GOOD, blockBytes, emptyBlock, trimmed, type SampleBlock } from "@modfield/series";
import type { Sample } from "@modfield/transport";
import { db, type LogSession } from "./db";

interface Open {
  block: SampleBlock;
  builder: BlockBuilder;
  id: number | undefined;
  dirty: boolean;
  /** Writes of one block are chained, so the first add's id is known before any put. */
  saving: Promise<void>;
}

/**
 * Writes one session's samples into IndexedDB in blocks of 10,000 per tag.
 * Partial blocks are flushed periodically (and before acknowledging the
 * agent), so a crash loses at most one flush interval of browser-side data.
 */
export class SessionWriter {
  private open = new Map<string, Open>();
  samples = 0;
  bytes = 0;

  constructor(readonly sessionId: string, private readonly numeric: Set<string>) {}

  ingest(samples: Pick<Sample, "t" | "tagId" | "value" | "quality">[], seq = 0): void {
    for (const s of samples) {
      if (!this.numeric.has(s.tagId)) continue;
      let o = this.open.get(s.tagId);
      if (o?.builder.full) {
        void this.persist(o);
        o = undefined;
      }
      if (!o) {
        const block = emptyBlock(s.tagId, s.t, seq);
        o = { block, builder: new BlockBuilder(block), id: undefined, dirty: false, saving: Promise.resolve() };
        this.open.set(s.tagId, o);
      }
      const ok = s.quality === "good" && typeof s.value === "number" && Number.isFinite(s.value);
      o.builder.push(s.t, ok ? (s.value as number) : Number.NaN, ok ? Q_GOOD : Q_BAD);
      o.dirty = true;
      this.samples++;
    }
  }

  /** Blocks still being filled, for live charts. */
  current(tagId: string): SampleBlock | undefined {
    const o = this.open.get(tagId);
    return o ? trimmed(o.block) : undefined;
  }

  private persist(o: Open): Promise<void> {
    o.dirty = false;
    o.saving = o.saving.then(async () => {
      const row = { ...trimmed(o.block), sessionId: this.sessionId };
      if (o.id === undefined) o.id = (await db.blocks.add(row)) as number;
      else await db.blocks.put({ ...row, id: o.id });
    });
    return o.saving;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.open.values()].filter((o) => o.dirty).map((o) => this.persist(o)));
    this.bytes = [...this.open.values()].reduce((n, o) => n + blockBytes(o.block), 0);
  }
}

export function numericTags(tags: TagDef[]): TagDef[] {
  return tags.filter((t) => t.table === "coil" || t.table === "discrete" || t.type !== "STRING");
}

/** One agent log record -> samples, decoded with the same code as the browser poller. */
export function decodeAgentRecord(
  plan: ReadBlock[],
  rec: { t: number; results: { words?: number[]; error?: string }[] },
): Pick<Sample, "t" | "tagId" | "value" | "quality">[] {
  const out: Pick<Sample, "t" | "tagId" | "value" | "quality">[] = [];
  plan.forEach((b, i) => {
    const r = rec.results[i];
    if (r?.words && r.words.length >= b.quantity) {
      const values = decodeBlock(b, r.words);
      for (const tag of b.tags) out.push({ t: rec.t, tagId: tag.id, value: values.get(tag.id)?.value, quality: "good" });
    } else {
      for (const tag of b.tags) out.push({ t: rec.t, tagId: tag.id, value: undefined, quality: "bad" });
    }
  });
  return out;
}

/** Total stored size of a session, from its blocks. */
export async function sessionBytes(sessionId: string): Promise<number> {
  let n = 0;
  await db.blocks.where("sessionId").equals(sessionId).each((b) => (n += blockBytes(b)));
  return n;
}

export async function deleteSession(s: LogSession): Promise<void> {
  await db.transaction("rw", db.sessions, db.blocks, db.markers, async () => {
    await db.blocks.where("sessionId").equals(s.id).delete();
    await db.markers.where("sessionId").equals(s.id).delete();
    await db.sessions.delete(s.id);
  });
}
