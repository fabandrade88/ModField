import { describe, expect, it } from "vitest";
import type { TagDef } from "@modfield/protocol";
import {
  DEMO_LINE,
  MockTransport,
  ModbusClient,
  Poller,
  SimulatedSerialPort,
  demoSlaves,
  detectPassive,
  detectSerial,
  discoverRegisters,
  idScanOrder,
  readTags,
  scanIds,
  serialCandidates,
  toRanges,
} from "../src";

const fast = { latencyMs: 1, chunkSize: 4 };

describe("scan order and candidates", () => {
  it("puts 1, 2 and 247 first", () => {
    const order = idScanOrder();
    expect(order.slice(0, 4)).toEqual([1, 2, 247, 3]);
    expect(order).toHaveLength(247);
    expect(new Set(order).size).toBe(247);
  });

  it("starts with the common field settings and has no duplicates", () => {
    const c = serialCandidates();
    expect(c[0]).toEqual({ baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 });
    expect(c[1]).toEqual({ baudRate: 19200, dataBits: 8, parity: "even", stopBits: 1 });
    expect(new Set(c.map((x) => JSON.stringify(x))).size).toBe(c.length);
    expect(c).toHaveLength(32);
  });

  it("merges addresses into ranges", () => {
    expect(toRanges([5, 1, 2, 3, 9, 10])).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 9, end: 10 },
    ]);
  });
});

describe("scanIds", () => {
  it("finds the three demo slaves; an exception still counts", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const hits = await scanIds(t, { ids: idScanOrder(1, 12), timeoutMs: 20 });
    expect(hits.map((h) => h.unitId)).toEqual([1, 2, 3]);
    // Slave 3 has no holding register 0: it answers exception 02.
    expect(hits[2]).toMatchObject({ answer: "exception", exception: 2 });
    await t.close();
  });

  it("stops when aborted", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const ac = new AbortController();
    let n = 0;
    await scanIds(t, {
      ids: idScanOrder(),
      timeoutMs: 5,
      signal: ac.signal,
      onProgress: (p) => {
        n = p.done;
        if (p.done === 5) ac.abort();
      },
    });
    expect(n).toBe(5);
    await t.close();
  });
});

describe("detectSerial", () => {
  it("finds 19200 8E1 on the demo line", async () => {
    const port = new SimulatedSerialPort(demoSlaves(), fast);
    const found = await detectSerial(port, { ids: [1] });
    expect(found?.settings).toEqual(DEMO_LINE);
    expect(found?.hit.unitId).toBe(1);
  });

  it("gives up when nobody answers", async () => {
    const port = new SimulatedSerialPort([], fast);
    const found = await detectSerial(port, { ids: [1], candidates: serialCandidates().slice(0, 3) });
    expect(found).toBeUndefined();
  });
});

describe("detectPassive", () => {
  it("hears another master at the right settings only", async () => {
    const port = new SimulatedSerialPort(demoSlaves(), { ...fast, chatterMs: 15 });
    const found = await detectPassive(port, { msPerCandidate: 80 });
    expect(found?.settings).toEqual(DEMO_LINE);
    expect(found!.frames.length).toBeGreaterThanOrEqual(2);
  });
});

describe("discoverRegisters", () => {
  it("maps the holding registers of slave 2 (0..2 and the string at 10..17)", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const client = new ModbusClient(t, { timeoutMs: 50 });
    const ranges = await discoverRegisters(client, { unitId: 2, table: "holding", from: 0, to: 31, blockSize: 8 });
    expect(ranges).toEqual([
      { start: 0, end: 2 },
      { start: 10, end: 17 },
    ]);
    await t.close();
  });
});

describe("Poller", () => {
  const tags: TagDef[] = [
    { id: "cmd", name: "cmd", unitId: 1, table: "holding", offset: 0, type: "UINT16", order: "ABCD" },
    { id: "ref", name: "ref", unitId: 1, table: "holding", offset: 1, type: "UINT16", order: "ABCD", scale: { rawMin: 0, rawMax: 6000, engMin: 0, engMax: 60 } },
    { id: "p", name: "p", unitId: 2, table: "holding", offset: 0, type: "FLOAT32", order: "CDAB" },
    { id: "ghost", name: "ghost", unitId: 9, table: "holding", offset: 0, type: "UINT16", order: "ABCD" },
  ];

  it("reads grouped blocks and marks a missing slave bad without losing the others", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const client = new ModbusClient(t, { timeoutMs: 30 });
    const p = new Poller(client, tags, 1000);
    expect(p.blocks).toHaveLength(3);
    const cycle = await p.once();
    const by = Object.fromEntries(cycle.samples.map((s) => [s.tagId, s]));
    expect(by.cmd).toMatchObject({ value: 1, quality: "good" });
    expect(by.ref).toMatchObject({ value: 45, quality: "good" });
    expect(by.p!.quality).toBe("good");
    expect(by.ghost).toMatchObject({ quality: "bad", value: undefined });
    expect(by.ghost!.error?.code).toBe("TIMEOUT");
    await t.close();
  });

  it("splits a block that spans an unmapped hole and keeps the split", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const client = new ModbusClient(t, { timeoutMs: 30 });
    // Slave 2: FLOAT32 at 0, UINT16 at 2, string at 10..17; 3..9 do not exist.
    const p = new Poller(
      client,
      [
        { id: "p", name: "p", unitId: 2, table: "holding", offset: 0, type: "FLOAT32", order: "CDAB" },
        { id: "ma", name: "ma", unitId: 2, table: "holding", offset: 2, type: "UINT16", order: "ABCD" },
        { id: "tag", name: "tag", unitId: 2, table: "holding", offset: 10, type: "STRING", order: "ABCD", stringLength: 15 },
      ],
      1000,
    );
    expect(p.blocks).toHaveLength(1);
    const first = await p.once();
    expect(first.samples.every((s) => s.quality === "good")).toBe(true);
    expect(first.samples.find((s) => s.tagId === "tag")?.value).toBe("PT-101 RECALQUE");
    expect(p.blocks.map((b) => [b.offset, b.quantity])).toEqual([
      [0, 3],
      [10, 8],
    ]);
    const before = t.stats.requests;
    await p.once();
    expect(t.stats.requests - before).toBe(2);
    await t.close();
  });

  it("emits cycles without accumulating delay", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    const client = new ModbusClient(t, { timeoutMs: 30 });
    const p = new Poller(client, tags.slice(0, 3), 40);
    const starts: number[] = [];
    await new Promise<void>((done) => {
      p.on("cycle", (c) => {
        starts.push(c.t);
        if (starts.length === 5) done();
      });
      p.start();
    });
    p.stop();
    const span = starts[4]! - starts[0]!;
    expect(span).toBeGreaterThanOrEqual(150);
    expect(span).toBeLessThan(260);
    await t.close();
  });

  it("readTags stops at a disconnected port", async () => {
    const t = new MockTransport({ line: fast });
    await t.open();
    t.line.unplug();
    const client = new ModbusClient(t, { timeoutMs: 30 });
    const { samples } = await readTags(client, new Poller(client, tags, 1000).blocks);
    expect(samples.every((s) => s.quality === "bad")).toBe(true);
    expect(samples).toHaveLength(2); // the first block's tags, then it stops
  });
});
