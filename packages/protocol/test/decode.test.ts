import { describe, expect, it } from "vitest";
import { checkCompatibility, describeRtuFrame, toHex } from "../src";
import { hex } from "./crc.test";

describe("describeRtuFrame", () => {
  it("describes a read request", () => {
    expect(describeRtuFrame(hex("11 03 006B 0003 7687"), "tx")).toMatchObject({
      unitId: 0x11,
      fc: 3,
      text: "Read Holding @107 ×3",
      crcOk: true,
    });
  });

  it("describes an exception response", () => {
    expect(describeRtuFrame(hex("0A 81 02 B053"), "rx").text).toBe(
      "Read Coils: exception 02 ILLEGAL DATA ADDRESS",
    );
  });

  it("flags a bad CRC", () => {
    expect(describeRtuFrame(hex("11 03 006B 0003 7688"), "tx").crcOk).toBe(false);
  });

  it("does not throw on garbage", () => {
    expect(() => describeRtuFrame(hex("FF"), "rx")).not.toThrow();
  });
});

describe("toHex", () => {
  it("formats bytes", () => expect(toHex(hex("0a ff 00"))).toBe("0A FF 00"));
});

describe("checkCompatibility", () => {
  it("blocks a major mismatch and degrades on minor", () => {
    expect(checkCompatibility({ major: 2, minor: 0 })).toBe("blocked");
    expect(checkCompatibility({ major: 1, minor: 3 })).toBe("degraded");
    expect(checkCompatibility({ major: 1, minor: 0 })).toBe("ok");
  });
});
