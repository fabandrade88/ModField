import { describe, expect, it } from "vitest";
import { checkCrc, crc16, withCrc } from "../src";

const hex = (s: string) => Uint8Array.from(s.replace(/\s+/g, "").match(/../g)!.map((b) => parseInt(b, 16)));

describe("crc16", () => {
  it("matches the CRC-16/MODBUS check value", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x4b37);
  });

  // Reference frames from the Simply Modbus examples and the Modbus spec.
  it.each([
    "01 03 0000 000A C5CD",
    "11 03 006B 0003 7687",
    "11 06 0001 0003 9A9B",
    "11 01 0013 0025 0E84",
    "11 03 06 AE41 5652 4340 49AD",
    "11 01 05 CD6BB20E1B 45E6",
    "0A 81 02 B053",
  ])("validates %s", (frame) => {
    const bytes = hex(frame);
    expect(checkCrc(bytes)).toBe(true);
    expect(withCrc(bytes.subarray(0, -2))).toEqual(bytes);
  });

  it("rejects a corrupted frame", () => {
    const bytes = hex("11 03 006B 0003 7687");
    bytes[3] ^= 0x01;
    expect(checkCrc(bytes)).toBe(false);
  });

  it("rejects frames too short to carry a CRC", () => {
    expect(checkCrc(hex("01 03 00"))).toBe(false);
  });
});

export { hex };
