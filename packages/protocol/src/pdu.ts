import { FC, LIMITS, MEI_READ_DEVICE_ID, isExceptionCode, type ExceptionCode } from "./codes";
import { ModbusError, exceptionError } from "./errors";

export type ReadBitsFc = typeof FC.READ_COILS | typeof FC.READ_DISCRETE_INPUTS;
export type ReadRegistersFc = typeof FC.READ_HOLDING_REGISTERS | typeof FC.READ_INPUT_REGISTERS;

/** Read Device Identification access codes: basic, regular, extended, one object. */
export type DeviceIdReadCode = 1 | 2 | 3 | 4;

export type ModbusRequest =
  | { fc: ReadBitsFc; address: number; quantity: number }
  | { fc: ReadRegistersFc; address: number; quantity: number }
  | { fc: typeof FC.WRITE_SINGLE_COIL; address: number; value: boolean }
  | { fc: typeof FC.WRITE_SINGLE_REGISTER; address: number; value: number }
  | { fc: typeof FC.WRITE_MULTIPLE_COILS; address: number; values: boolean[] }
  | { fc: typeof FC.WRITE_MULTIPLE_REGISTERS; address: number; values: number[] }
  | { fc: typeof FC.ENCAPSULATED_INTERFACE; readCode: DeviceIdReadCode; objectId: number };

export type ModbusResponse =
  | { fc: ReadBitsFc; bits: boolean[] }
  | { fc: ReadRegistersFc; registers: number[] }
  | { fc: typeof FC.WRITE_SINGLE_COIL; address: number; value: boolean }
  | { fc: typeof FC.WRITE_SINGLE_REGISTER; address: number; value: number }
  | { fc: typeof FC.WRITE_MULTIPLE_COILS; address: number; quantity: number }
  | { fc: typeof FC.WRITE_MULTIPLE_REGISTERS; address: number; quantity: number }
  | {
      fc: typeof FC.ENCAPSULATED_INTERFACE;
      readCode: DeviceIdReadCode;
      conformity: number;
      moreFollows: boolean;
      nextObjectId: number;
      /** 0 VendorName, 1 ProductCode, 2 MajorMinorRevision, 3 VendorUrl, 4 ProductName, 5 ModelName, ... */
      objects: Record<number, string>;
    };

export type ResponseFor<F extends ModbusRequest["fc"]> = Extract<ModbusResponse, { fc: F }>;

const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const rd16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;

function assertRange(name: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${v}`);
  }
}

export function validateRequest(req: ModbusRequest): void {
  if (req.fc === FC.ENCAPSULATED_INTERFACE) {
    assertRange("objectId", req.objectId, 0, 255);
    return;
  }
  assertRange("address", req.address, 0, 0xffff);
  let qty = 1;
  switch (req.fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
      assertRange("quantity", (qty = req.quantity), 1, LIMITS.maxReadBits);
      break;
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      assertRange("quantity", (qty = req.quantity), 1, LIMITS.maxReadRegisters);
      break;
    case FC.WRITE_SINGLE_REGISTER:
      assertRange("value", req.value, 0, 0xffff);
      break;
    case FC.WRITE_MULTIPLE_COILS:
      assertRange("quantity", (qty = req.values.length), 1, LIMITS.maxWriteCoils);
      break;
    case FC.WRITE_MULTIPLE_REGISTERS:
      assertRange("quantity", (qty = req.values.length), 1, LIMITS.maxWriteRegisters);
      req.values.forEach((v) => assertRange("value", v, 0, 0xffff));
      break;
  }
  if (req.address + qty > 0x10000) throw new RangeError("address + quantity exceeds 65536");
}

function packBits(bits: boolean[]): number[] {
  const out = new Array<number>(Math.ceil(bits.length / 8)).fill(0);
  bits.forEach((b, i) => {
    if (b) out[i >> 3]! |= 1 << (i & 7);
  });
  return out;
}

function unpackBits(bytes: Uint8Array, offset: number, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i++) out.push(((bytes[offset + (i >> 3)]! >> (i & 7)) & 1) === 1);
  return out;
}

export function encodeRequest(req: ModbusRequest): Uint8Array {
  validateRequest(req);
  switch (req.fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return Uint8Array.of(req.fc, ...u16(req.address), ...u16(req.quantity));
    case FC.WRITE_SINGLE_COIL:
      return Uint8Array.of(req.fc, ...u16(req.address), req.value ? 0xff : 0x00, 0x00);
    case FC.WRITE_SINGLE_REGISTER:
      return Uint8Array.of(req.fc, ...u16(req.address), ...u16(req.value));
    case FC.WRITE_MULTIPLE_COILS: {
      const packed = packBits(req.values);
      return Uint8Array.of(req.fc, ...u16(req.address), ...u16(req.values.length), packed.length, ...packed);
    }
    case FC.WRITE_MULTIPLE_REGISTERS:
      return Uint8Array.of(
        req.fc,
        ...u16(req.address),
        ...u16(req.values.length),
        req.values.length * 2,
        ...req.values.flatMap(u16),
      );
    case FC.ENCAPSULATED_INTERFACE:
      return Uint8Array.of(req.fc, MEI_READ_DEVICE_ID, req.readCode, req.objectId);
  }
}

function invalid(msg: string): ModbusError {
  return new ModbusError("INVALID_RESPONSE", msg);
}

/** Decodes a response PDU (no unit ID, no CRC) and checks it answers `req`. */
export function decodeResponse<R extends ModbusRequest>(req: R, pdu: Uint8Array): ResponseFor<R["fc"]> {
  const fc = pdu[0];
  if (fc === undefined) throw invalid("empty response");
  if (fc === (req.fc | 0x80)) {
    const ex = pdu[1];
    if (pdu.length !== 2 || ex === undefined || !isExceptionCode(ex)) throw invalid("malformed exception response");
    throw exceptionError(req.fc, ex);
  }
  if (fc !== req.fc) throw invalid(`expected function ${req.fc}, got ${fc}`);

  const res = ((): ModbusResponse => {
    switch (req.fc) {
      case FC.READ_COILS:
      case FC.READ_DISCRETE_INPUTS: {
        const n = Math.ceil(req.quantity / 8);
        if (pdu[1] !== n || pdu.length !== 2 + n) throw invalid("byte count does not match quantity");
        return { fc: req.fc, bits: unpackBits(pdu, 2, req.quantity) };
      }
      case FC.READ_HOLDING_REGISTERS:
      case FC.READ_INPUT_REGISTERS: {
        const n = req.quantity * 2;
        if (pdu[1] !== n || pdu.length !== 2 + n) throw invalid("byte count does not match quantity");
        const registers: number[] = [];
        for (let i = 0; i < req.quantity; i++) registers.push(rd16(pdu, 2 + i * 2));
        return { fc: req.fc, registers };
      }
      case FC.WRITE_SINGLE_COIL:
      case FC.WRITE_SINGLE_REGISTER:
      case FC.WRITE_MULTIPLE_COILS:
      case FC.WRITE_MULTIPLE_REGISTERS: {
        // All four echo address and a second word; the request bytes must match.
        const expected = encodeRequest(req).subarray(0, 5);
        if (pdu.length !== 5 || expected.some((b, i) => b !== pdu[i])) throw invalid("write echo does not match request");
        const address = rd16(pdu, 1);
        if (req.fc === FC.WRITE_SINGLE_COIL) return { fc: req.fc, address, value: pdu[3] === 0xff };
        if (req.fc === FC.WRITE_SINGLE_REGISTER) return { fc: req.fc, address, value: rd16(pdu, 3) };
        return { fc: req.fc, address, quantity: rd16(pdu, 3) };
      }
      case FC.ENCAPSULATED_INTERFACE:
        return decodeDeviceId(pdu);
    }
  })();
  return res as ResponseFor<R["fc"]>;
}

function decodeDeviceId(pdu: Uint8Array): ModbusResponse {
  if (pdu.length < 7 || pdu[1] !== MEI_READ_DEVICE_ID) throw invalid("malformed device identification");
  const readCode = pdu[2]!;
  if (readCode < 1 || readCode > 4) throw invalid("invalid read device id code");
  const count = pdu[6]!;
  const objects: Record<number, string> = {};
  let i = 7;
  for (let k = 0; k < count; k++) {
    const id = pdu[i];
    const len = pdu[i + 1];
    if (id === undefined || len === undefined || i + 2 + len > pdu.length) throw invalid("truncated device id object");
    objects[id] = new TextDecoder("latin1").decode(pdu.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  if (i !== pdu.length) throw invalid("trailing bytes after device id objects");
  return {
    fc: FC.ENCAPSULATED_INTERFACE,
    readCode: readCode as DeviceIdReadCode,
    conformity: pdu[3]!,
    moreFollows: pdu[4] === 0xff,
    nextObjectId: pdu[5]!,
    objects,
  };
}

// --- Server side: used by the simulated slave and by the traffic decoder. ---

export function decodeRequest(pdu: Uint8Array): ModbusRequest {
  const fc = pdu[0];
  const bad = () => new ModbusError("INVALID_RESPONSE", `malformed request for function ${fc}`);
  switch (fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      if (pdu.length !== 5) throw bad();
      return { fc, address: rd16(pdu, 1), quantity: rd16(pdu, 3) };
    case FC.WRITE_SINGLE_COIL:
      if (pdu.length !== 5 || pdu[4] !== 0 || (pdu[3] !== 0xff && pdu[3] !== 0)) throw bad();
      return { fc, address: rd16(pdu, 1), value: pdu[3] === 0xff };
    case FC.WRITE_SINGLE_REGISTER:
      if (pdu.length !== 5) throw bad();
      return { fc, address: rd16(pdu, 1), value: rd16(pdu, 3) };
    case FC.WRITE_MULTIPLE_COILS: {
      const qty = rd16(pdu, 3);
      if (pdu.length !== 6 + pdu[5]! || pdu[5] !== Math.ceil(qty / 8)) throw bad();
      return { fc, address: rd16(pdu, 1), values: unpackBits(pdu, 6, qty) };
    }
    case FC.WRITE_MULTIPLE_REGISTERS: {
      const qty = rd16(pdu, 3);
      if (pdu.length !== 6 + pdu[5]! || pdu[5] !== qty * 2) throw bad();
      const values: number[] = [];
      for (let i = 0; i < qty; i++) values.push(rd16(pdu, 6 + i * 2));
      return { fc, address: rd16(pdu, 1), values };
    }
    case FC.ENCAPSULATED_INTERFACE:
      if (pdu.length !== 4 || pdu[1] !== MEI_READ_DEVICE_ID) throw bad();
      return { fc, readCode: pdu[2] as DeviceIdReadCode, objectId: pdu[3]! };
    default:
      throw bad();
  }
}

export function encodeResponse(res: ModbusResponse): Uint8Array {
  switch (res.fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS: {
      const packed = packBits(res.bits);
      return Uint8Array.of(res.fc, packed.length, ...packed);
    }
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return Uint8Array.of(res.fc, res.registers.length * 2, ...res.registers.flatMap(u16));
    case FC.WRITE_SINGLE_COIL:
      return Uint8Array.of(res.fc, ...u16(res.address), res.value ? 0xff : 0, 0);
    case FC.WRITE_SINGLE_REGISTER:
      return Uint8Array.of(res.fc, ...u16(res.address), ...u16(res.value));
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return Uint8Array.of(res.fc, ...u16(res.address), ...u16(res.quantity));
    case FC.ENCAPSULATED_INTERFACE: {
      const objs = Object.entries(res.objects).flatMap(([id, value]) => {
        const bytes = [...value].map((c) => c.charCodeAt(0) & 0xff);
        return [Number(id), bytes.length, ...bytes];
      });
      return Uint8Array.of(
        res.fc,
        MEI_READ_DEVICE_ID,
        res.readCode,
        res.conformity,
        res.moreFollows ? 0xff : 0,
        res.nextObjectId,
        Object.keys(res.objects).length,
        ...objs,
      );
    }
  }
}

export function encodeException(fc: number, exception: ExceptionCode): Uint8Array {
  return Uint8Array.of(fc | 0x80, exception);
}
