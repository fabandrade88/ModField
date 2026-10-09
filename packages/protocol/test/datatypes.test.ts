import { describe, expect, it } from "vitest";
import {
  decodeValue,
  encodeValue,
  formatClassic,
  formatRegister,
  parseClassic,
  toEngineering,
  toOffset,
  toRaw,
  type ByteOrder,
  type DataType,
} from "../src";

describe("byte order", () => {
  // 123.456 as FLOAT32 is 0x42F6E979: bytes A=42 B=F6 C=E9 D=79.
  it.each<[ByteOrder, number[]]>([
    ["ABCD", [0x42f6, 0xe979]],
    ["CDAB", [0xe979, 0x42f6]],
    ["BADC", [0xf642, 0x79e9]],
    ["DCBA", [0x79e9, 0xf642]],
  ])("FLOAT32 %s", (order, regs) => {
    expect(decodeValue(regs, "FLOAT32", order)).toBeCloseTo(123.456, 3);
    expect(encodeValue(Math.fround(123.456), "FLOAT32", order)).toEqual(regs);
  });

  it("FLOAT64 CDAB reverses all four registers", () => {
    const abcd = encodeValue(Math.PI, "FLOAT64", "ABCD");
    expect(encodeValue(Math.PI, "FLOAT64", "CDAB")).toEqual([...abcd].reverse());
    expect(decodeValue([...abcd].reverse(), "FLOAT64", "CDAB")).toBe(Math.PI);
  });

  it("16-bit types honor byte swap only", () => {
    expect(decodeValue([0x1234], "UINT16", "CDAB")).toBe(0x1234);
    expect(decodeValue([0x1234], "UINT16", "BADC")).toBe(0x3412);
  });
});

describe("integer types", () => {
  it.each<[DataType, number, number[]]>([
    ["INT16", -1, [0xffff]],
    ["UINT16", 65535, [0xffff]],
    ["INT32", -2, [0xffff, 0xfffe]],
    ["UINT32", 0xdeadbeef, [0xdead, 0xbeef]],
    ["INT32", 100000, [0x0001, 0x86a0]],
  ])("%s %d", (type, value, regs) => {
    expect(decodeValue(regs, type)).toBe(value);
    expect(encodeValue(value, type)).toEqual(regs);
  });

  it("rejects out-of-range and fractional values", () => {
    expect(() => encodeValue(70000, "UINT16")).toThrow(RangeError);
    expect(() => encodeValue(1.5, "INT32")).toThrow(RangeError);
    expect(() => encodeValue(-1, "UINT32")).toThrow(RangeError);
  });

  it("needs enough registers", () => {
    expect(() => decodeValue([1], "FLOAT32")).toThrow(RangeError);
  });
});

describe("strings", () => {
  it("decodes high byte first and stops at NUL", () => {
    expect(decodeValue([0x4d6f, 0x6446, 0x0000], "STRING")).toBe("ModF");
  });
  it("encodes and pads with NUL", () => {
    expect(encodeValue("ABC", "STRING", "ABCD", 4)).toEqual([0x4142, 0x4300]);
  });
  it("honors byte swap", () => {
    expect(decodeValue([0x6f4d], "STRING", "BADC")).toBe("Mo");
  });
});

describe("scaling", () => {
  const s = { rawMin: 0, rawMax: 65535, engMin: 0, engMax: 10 };
  it("scales raw to engineering and back", () => {
    expect(toEngineering(32767.5, s)).toBeCloseTo(5);
    expect(toRaw(5, s)).toBeCloseTo(32767.5);
  });
  it("scales 4-20 mA in raw counts", () => {
    const ma = { rawMin: 4000, rawMax: 20000, engMin: 0, engMax: 250 };
    expect(toEngineering(12000, ma)).toBe(125);
  });
  it("rejects a degenerate range", () => {
    expect(() => toEngineering(1, { ...s, rawMax: 0 })).toThrow(RangeError);
  });
});

describe("formatRegister", () => {
  it("formats hex and grouped binary", () => {
    expect(formatRegister(0x1f2a, "hex")).toBe("0x1F2A");
    expect(formatRegister(0x1f2a, "bin")).toBe("0001 1111 0010 1010");
  });
});

describe("addressing", () => {
  it("converts base 0 and base 1", () => {
    expect(toOffset(1, 1)).toBe(0);
    expect(toOffset(0, 0)).toBe(0);
    expect(() => toOffset(0, 1)).toThrow(RangeError);
  });

  it.each([
    ["40001", "holding", 0],
    ["30010", "input", 9],
    ["00001", "coil", 0],
    ["10002", "discrete", 1],
    ["465536", "holding", 65535],
  ] as const)("parses %s", (text, table, offset) => {
    expect(parseClassic(text)).toEqual({ table, offset });
  });

  it("formats classic notation, switching to 6 digits past 9999", () => {
    expect(formatClassic("holding", 0)).toBe("40001");
    expect(formatClassic("holding", 9998)).toBe("49999");
    expect(formatClassic("holding", 9999)).toBe("410000");
  });

  it("rejects invalid classic addresses", () => {
    expect(() => parseClassic("20001")).toThrow(/prefix/);
    expect(() => parseClassic("40000")).toThrow(/range/);
    expect(() => parseClassic("4001")).toThrow();
  });
});
