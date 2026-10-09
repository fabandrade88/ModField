import { describe, expect, it } from "vitest";
import { decodeBlock, encodeRtu, encodeValue, findFrames, formatTagValue, planReads, type TagDef } from "../src";
import { hex } from "./crc.test";

const tag = (id: string, offset: number, extra: Partial<TagDef> = {}): TagDef => ({
  id,
  name: id,
  unitId: 1,
  table: "holding",
  offset,
  type: "UINT16",
  order: "ABCD",
  ...extra,
});

describe("planReads", () => {
  it("merges neighbours and small gaps into one request", () => {
    const blocks = planReads([tag("a", 0), tag("b", 1), tag("c", 4, { type: "FLOAT32" })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ offset: 0, quantity: 6 });
  });

  it("splits on a large gap", () => {
    const blocks = planReads([tag("a", 0), tag("b", 100)], { maxGap: 8 });
    expect(blocks.map((b) => [b.offset, b.quantity])).toEqual([
      [0, 1],
      [100, 1],
    ]);
  });

  it("never exceeds 125 registers per request", () => {
    const tags = Array.from({ length: 70 }, (_, i) => tag(`t${i}`, i * 2, { type: "FLOAT32" }));
    const blocks = planReads(tags);
    expect(blocks.every((b) => b.quantity <= 125)).toBe(true);
    expect(blocks.reduce((n, b) => n + b.tags.length, 0)).toBe(70);
    expect(blocks).toHaveLength(2);
  });

  it("keeps slaves and tables apart", () => {
    const blocks = planReads([tag("a", 0), tag("b", 1, { unitId: 2 }), tag("c", 2, { table: "input" })]);
    expect(blocks).toHaveLength(3);
  });

  it("50 FLOAT32 tags in 5 contiguous areas become 5 requests", () => {
    const tags = Array.from({ length: 50 }, (_, i) => tag(`t${i}`, Math.floor(i / 10) * 1000 + (i % 10) * 2, { type: "FLOAT32" }));
    expect(planReads(tags)).toHaveLength(5);
  });
});

describe("splitBlock", () => {
  it("splits a merged block into gapless runs, then into single tags", async () => {
    const { splitBlock } = await import("../src");
    const [merged] = planReads([tag("a", 0, { type: "FLOAT32" }), tag("b", 2), tag("s", 10)]);
    const runs = splitBlock(merged!);
    expect(runs.map((r) => [r.offset, r.quantity])).toEqual([
      [0, 3],
      [10, 1],
    ]);
    expect(splitBlock(runs[0]!).map((r) => r.tags[0]!.id)).toEqual(["a", "b"]);
    expect(splitBlock(runs[1]!)).toEqual([runs[1]]);
  });
});

describe("decodeBlock", () => {
  it("decodes typed and scaled values at their positions", () => {
    const t1 = tag("raw", 10);
    const t2 = tag("pressure", 12, { type: "FLOAT32", order: "CDAB" });
    const t3 = tag("level", 15, { scale: { rawMin: 0, rawMax: 10000, engMin: 0, engMax: 100 } });
    const [block] = planReads([t1, t2, t3]);
    const words = [7, 0, ...encodeValue(6.25, "FLOAT32", "CDAB"), 0, 2500];
    const out = decodeBlock(block!, words);
    expect(out.get("raw")?.value).toBe(7);
    expect(out.get("pressure")?.value).toBe(6.25);
    expect(out.get("level")?.value).toBe(25);
  });
});

describe("formatTagValue", () => {
  it("applies decimals and unit", () => {
    expect(formatTagValue({ decimals: 2, unit: "bar" }, 6.256)).toBe("6.26 bar");
    expect(formatTagValue({}, 42)).toBe("42");
    expect(formatTagValue({ unit: "bar" }, 7.5)).toBe("7.5 bar");
    expect(formatTagValue({}, 1 / 3)).toBe("0.333333");
    expect(formatTagValue({}, undefined)).toBe("—");
  });
});

describe("findFrames", () => {
  it("finds request and response frames between garbage", () => {
    const req = hex("11 03 006B 0003 7687");
    const res = hex("11 03 06 AE41 5652 4340 49AD");
    const capture = new Uint8Array([0xff, 0x00, ...req, 0x55, ...res, 0x12]);
    const frames = findFrames(capture);
    expect(frames.map((f) => f.kind)).toEqual(["request", "response"]);
    expect(frames[1]!.frame).toEqual(res);
  });

  it("finds nothing in noise", () => {
    const noise = Uint8Array.from({ length: 500 }, (_, i) => (i * 37 + 11) & 0xff);
    expect(findFrames(noise)).toEqual([]);
  });

  it("finds exception frames", () => {
    expect(findFrames(encodeRtu(10, hex("81 02")))).toHaveLength(1);
  });
});
