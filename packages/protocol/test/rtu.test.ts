import { describe, expect, it } from "vitest";
import { RtuResponseReader, encodeRtu, rtuRequestLength, rtuResponseLength } from "../src";
import { hex } from "./crc.test";

describe("encodeRtu", () => {
  it("adds unit id and CRC", () => {
    expect(encodeRtu(0x11, hex("03 006B 0003"))).toEqual(hex("11 03 006B 0003 7687"));
  });
});

describe("rtuResponseLength", () => {
  it.each([
    ["11", undefined],
    ["11 03", undefined],
    ["11 03 06", 11],
    ["11 01 05", 10],
    ["11 06", 8],
    ["11 10", 8],
    ["0A 81", 5],
    ["11 63", null],
    ["11 2B 0E 01 01 00 00", undefined],
    ["11 2B 0E 01 01 00 00 01", undefined],
    ["11 2B 0E 01 01 00 00 01 00", undefined],
    ["11 2B 0E 01 01 00 00 01 00 03", 15],
    ["11 2B 0E 01 01 00 00 02 00 01 41", undefined],
    ["11 2B 0E 01 01 00 00 02 00 01 41 01 02", 17],
    ["11 2B 0E 01 01 00 00 00", 10],
  ])("%s -> %s", (bytes, expected) => {
    expect(rtuResponseLength(hex(bytes))).toBe(expected);
  });
});

describe("rtuRequestLength", () => {
  it.each([
    ["11 03", 8],
    ["11 10 0001 0002", undefined],
    ["11 10 0001 0002 04", 13],
    ["11 2B", 7],
    ["11 99", null],
  ])("%s -> %s", (bytes, expected) => {
    expect(rtuRequestLength(hex(bytes))).toBe(expected);
  });
});

describe("RtuResponseReader", () => {
  const frame = hex("11 03 06 AE41 5652 4340 49AD");

  it("assembles a frame split in arbitrary chunks", () => {
    for (let cut = 1; cut < frame.length; cut++) {
      const r = new RtuResponseReader(0x11);
      expect(r.push(frame.subarray(0, cut))).toEqual({ done: false });
      const res = r.push(frame.subarray(cut));
      expect(res.done && "pdu" in res && res.pdu).toEqual(hex("03 06 AE41 5652 4340"));
    }
  });

  it("assembles a frame delivered one byte at a time", () => {
    const r = new RtuResponseReader(0x11);
    let res = r.push(frame.subarray(0, 1));
    for (let i = 1; i < frame.length; i++) res = r.push(frame.subarray(i, i + 1));
    expect(res.done && "pdu" in res).toBe(true);
  });

  it("reports CRC_ERROR", () => {
    const bad = frame.slice();
    bad[5] ^= 0xff;
    const res = new RtuResponseReader(0x11).push(bad);
    expect(res.done && "error" in res && res.error.code).toBe("CRC_ERROR");
  });

  it("reports a reply from the wrong unit as INVALID_RESPONSE", () => {
    const res = new RtuResponseReader(0x12).push(frame);
    expect(res.done && "error" in res && res.error.code).toBe("INVALID_RESPONSE");
  });

  it("completes an exception frame at 5 bytes", () => {
    const res = new RtuResponseReader(0x0a).push(hex("0A 81 02 B053"));
    expect(res.done && "pdu" in res && res.pdu).toEqual(hex("81 02"));
  });

  it("assembles a device identification response", async () => {
    const { FC, encodeResponse } = await import("../src");
    const pdu = encodeResponse({
      fc: FC.ENCAPSULATED_INTERFACE,
      readCode: 1,
      conformity: 1,
      moreFollows: false,
      nextObjectId: 0,
      objects: { 0: "ModField", 1: "SIM-1" },
    });
    const frame = encodeRtu(5, pdu);
    const r = new RtuResponseReader(5);
    expect(r.push(frame.subarray(0, 12))).toEqual({ done: false });
    const res = r.push(frame.subarray(12));
    expect(res.done && "pdu" in res && res.pdu).toEqual(pdu);
  });

  it("keeps trailing bytes in extra", () => {
    const r = new RtuResponseReader(0x0a);
    r.push(hex("0A 81 02 B053 FF FF"));
    expect(r.extra).toEqual(hex("FF FF"));
  });
});
