import { describe, expect, it } from "vitest";
import {
  FC,
  ModbusError,
  decodeRequest,
  decodeResponse,
  encodeException,
  encodeRequest,
  encodeResponse,
  type ModbusRequest,
} from "../src";
import { hex } from "./crc.test";

describe("encodeRequest", () => {
  it.each<[ModbusRequest, string]>([
    [{ fc: FC.READ_HOLDING_REGISTERS, address: 0x6b, quantity: 3 }, "03 006B 0003"],
    [{ fc: FC.READ_COILS, address: 0x13, quantity: 0x25 }, "01 0013 0025"],
    [{ fc: FC.WRITE_SINGLE_COIL, address: 0xac, value: true }, "05 00AC FF00"],
    [{ fc: FC.WRITE_SINGLE_REGISTER, address: 1, value: 3 }, "06 0001 0003"],
    [{ fc: FC.WRITE_MULTIPLE_REGISTERS, address: 1, values: [0x000a, 0x0102] }, "10 0001 0002 04 000A 0102"],
    [
      { fc: FC.WRITE_MULTIPLE_COILS, address: 0x13, values: [1, 0, 1, 1, 0, 0, 1, 1, 1, 0].map(Boolean) },
      "0F 0013 000A 02 CD 01",
    ],
    [{ fc: FC.ENCAPSULATED_INTERFACE, readCode: 1, objectId: 0 }, "2B 0E 01 00"],
  ])("%j", (req, expected) => {
    expect(encodeRequest(req)).toEqual(hex(expected));
    expect(decodeRequest(hex(expected))).toEqual(req);
  });

  it.each<ModbusRequest>([
    { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 126 },
    { fc: FC.READ_COILS, address: 0, quantity: 2001 },
    { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 0 },
    { fc: FC.READ_HOLDING_REGISTERS, address: 65535, quantity: 2 },
    { fc: FC.WRITE_SINGLE_REGISTER, address: 0, value: 0x10000 },
    { fc: FC.WRITE_MULTIPLE_REGISTERS, address: 0, values: [] },
  ])("rejects out-of-range %j", (req) => {
    expect(() => encodeRequest(req)).toThrow(RangeError);
  });
});

describe("decodeResponse", () => {
  it("decodes holding registers", () => {
    const req = { fc: FC.READ_HOLDING_REGISTERS, address: 0x6b, quantity: 3 } as const;
    expect(decodeResponse(req, hex("03 06 AE41 5652 4340")).registers).toEqual([0xae41, 0x5652, 0x4340]);
  });

  it("decodes coils and trims padding bits", () => {
    const req = { fc: FC.READ_COILS, address: 0x13, quantity: 0x25 } as const;
    const bits = decodeResponse(req, hex("01 05 CD6BB20E1B")).bits;
    expect(bits).toHaveLength(37);
    expect(bits.slice(0, 8)).toEqual([1, 0, 1, 1, 0, 0, 1, 1].map(Boolean));
    expect(bits.slice(32)).toEqual([1, 1, 0, 1, 1].map(Boolean));
  });

  it("throws MODBUS_EXCEPTION with the code", () => {
    const req = { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 } as const;
    const err = (() => {
      try {
        decodeResponse(req, hex("83 02"));
      } catch (e) {
        return e;
      }
    })() as ModbusError;
    expect(err).toBeInstanceOf(ModbusError);
    expect(err.code).toBe("MODBUS_EXCEPTION");
    expect(err.exception).toBe(2);
    expect(err.tag).toBe("MODBUS_EXCEPTION 02");
  });

  it("rejects an unknown exception code such as 09", () => {
    const req = { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 } as const;
    expect(() => decodeResponse(req, hex("83 09"))).toThrow(/malformed exception/);
  });

  it.each([
    ["wrong function", "04 02 0001"],
    ["byte count mismatch", "03 04 0001"],
    ["length mismatch", "03 02 0001 FF"],
  ])("rejects %s as INVALID_RESPONSE", (_, pdu) => {
    const req = { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 } as const;
    expect(() => decodeResponse(req, hex(pdu))).toThrow(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });

  it("checks the write echo", () => {
    const req = { fc: FC.WRITE_SINGLE_REGISTER, address: 1, value: 3 } as const;
    expect(decodeResponse(req, hex("06 0001 0003"))).toEqual({ fc: 6, address: 1, value: 3 });
    expect(() => decodeResponse(req, hex("06 0001 0004"))).toThrow(/echo/);
  });

  it("round-trips device identification", () => {
    const req = { fc: FC.ENCAPSULATED_INTERFACE, readCode: 1, objectId: 0 } as const;
    const res = {
      fc: FC.ENCAPSULATED_INTERFACE,
      readCode: 1,
      conformity: 0x01,
      moreFollows: false,
      nextObjectId: 0,
      objects: { 0: "ModField", 1: "SIM-1", 2: "v1.0" },
    } as const;
    expect(decodeResponse(req, encodeResponse(res))).toEqual(res);
  });
});

describe("server side", () => {
  it("round-trips every response type", () => {
    const cases = [
      { fc: FC.READ_DISCRETE_INPUTS, bits: [true, false, true] },
      { fc: FC.READ_INPUT_REGISTERS, registers: [1, 2, 0xffff] },
      { fc: FC.WRITE_SINGLE_COIL, address: 7, value: false },
      { fc: FC.WRITE_MULTIPLE_COILS, address: 7, quantity: 9 },
      { fc: FC.WRITE_MULTIPLE_REGISTERS, address: 7, quantity: 2 },
    ] as const;
    expect(encodeResponse(cases[0])).toEqual(hex("02 01 05"));
    expect(encodeResponse(cases[1])).toEqual(hex("04 06 0001 0002 FFFF"));
    expect(encodeResponse(cases[2])).toEqual(hex("05 0007 0000"));
    expect(encodeResponse(cases[3])).toEqual(hex("0F 0007 0009"));
    expect(encodeResponse(cases[4])).toEqual(hex("10 0007 0002"));
  });

  it("encodes exceptions", () => {
    expect(encodeException(3, 2)).toEqual(hex("83 02"));
  });
});
