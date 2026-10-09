import { ModbusError, decodeBlock, isBitTable, planReads, splitBlock, type PlanOptions, type ReadBlock, type TagDef } from "@modfield/protocol";
import type { ModbusClient } from "./client";
import { Emitter } from "./emitter";

export type Quality = "good" | "bad";

export interface Sample {
  /** Epoch ms, UTC. */
  t: number;
  tagId: string;
  value: number | string | undefined;
  quality: Quality;
  raw?: number[];
  error?: ModbusError;
}

export interface Cycle {
  t: number;
  samples: Sample[];
  /** How long the whole cycle took, ms. */
  cycleMs: number;
  requests: number;
}

export async function readBlock(client: ModbusClient, b: ReadBlock): Promise<number[]> {
  return isBitTable(b.table)
    ? (await client.readBits(b.unitId, b.table as "coil" | "discrete", b.offset, b.quantity)).map(Number)
    : client.readRegisters(b.unitId, b.table as "holding" | "input", b.offset, b.quantity);
}

/**
 * Reads every tag once, block by block. A failed block marks its tags bad; the
 * others still read. A merged block refused with an exception is split and
 * retried right away (reads are safe to repeat); the returned `blocks` keep
 * the split, so later cycles do not pay for it again.
 */
export async function readTags(
  client: ModbusClient,
  blocks: ReadBlock[],
  now: () => number = Date.now,
): Promise<{ samples: Sample[]; blocks: ReadBlock[] }> {
  const samples: Sample[] = [];
  const plan: ReadBlock[] = [];
  const queue = [...blocks];
  while (queue.length) {
    const b = queue.shift()!;
    const t = now();
    try {
      const values = decodeBlock(b, await readBlock(client, b));
      for (const tag of b.tags) {
        const v = values.get(tag.id)!;
        samples.push({ t, tagId: tag.id, value: v.value, raw: v.raw, quality: "good" });
      }
      plan.push(b);
    } catch (e) {
      const error = e instanceof ModbusError ? e : new ModbusError("INVALID_RESPONSE", String(e));
      if (error.code === "MODBUS_EXCEPTION" && b.tags.length > 1) {
        queue.unshift(...splitBlock(b));
        continue;
      }
      for (const tag of b.tags) samples.push({ t, tagId: tag.id, value: undefined, quality: "bad", error });
      plan.push(b);
      if (error.code === "PORT_DISCONNECTED") {
        plan.push(...queue);
        break;
      }
    }
  }
  return { samples, blocks: plan };
}

/**
 * Cyclic read of a tag list. Each cycle is scheduled from the start of the
 * previous one, so delays never accumulate; when a cycle is slower than the
 * interval, the next starts immediately and `cycleMs` shows the real time.
 */
export class Poller {
  private readonly events = new Emitter<{ cycle: Cycle }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  /** Read plan; blocks refused by the device get split and stay split. */
  blocks: ReadBlock[];

  constructor(
    private readonly client: ModbusClient,
    tags: readonly TagDef[],
    public intervalMs: number,
    plan: PlanOptions = {},
  ) {
    this.blocks = planReads(tags, plan);
  }

  get isRunning(): boolean {
    return this.running;
  }

  on(event: "cycle", cb: (c: Cycle) => void): () => void {
    return this.events.on(event, cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** One cycle now, outside the schedule (the R key). */
  async once(): Promise<Cycle> {
    const t = Date.now();
    const started = performance.now();
    const { samples, blocks } = await readTags(this.client, this.blocks);
    this.blocks = blocks;
    return { t, samples, cycleMs: performance.now() - started, requests: blocks.length };
  }

  private async tick(): Promise<void> {
    const started = performance.now();
    const cycle = await this.once();
    if (!this.running) return;
    this.events.emit("cycle", cycle);
    const elapsed = performance.now() - started;
    this.timer = setTimeout(() => void this.tick(), Math.max(0, this.intervalMs - elapsed));
  }
}
