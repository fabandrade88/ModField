import { checkCrc, withCrc } from "./crc";
import { FC } from "./codes";
import { ModbusError } from "./errors";

export function encodeRtu(unitId: number, pdu: Uint8Array): Uint8Array {
  const body = new Uint8Array(pdu.length + 1);
  body[0] = unitId;
  body.set(pdu, 1);
  return withCrc(body);
}

/**
 * Total length of an RTU response frame (unit + PDU + CRC), from the bytes
 * received so far. `undefined` means more bytes are needed to tell; `null`
 * means the bytes cannot start a valid response.
 *
 * Frames are delimited by length, not by 3.5-char silence: Web Serial and USB
 * converters deliver bytes in chunks with no usable inter-byte timing.
 */
export function rtuResponseLength(buf: Uint8Array): number | null | undefined {
  if (buf.length < 2) return undefined;
  const fc = buf[1]!;
  if (fc & 0x80) return 5;
  switch (fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return buf.length < 3 ? undefined : 5 + buf[2]!;
    case FC.WRITE_SINGLE_COIL:
    case FC.WRITE_SINGLE_REGISTER:
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return 8;
    case FC.ENCAPSULATED_INTERFACE: {
      // unit, 2B, 0E, code, conformity, more, next, count, then {id, len, value}*
      if (buf.length < 8) return undefined;
      let i = 8;
      for (let k = 0; k < buf[7]!; k++) {
        if (buf.length < i + 2) return undefined;
        i += 2 + buf[i + 1]!;
      }
      return i + 2;
    }
    default:
      return null;
  }
}

/** Same as `rtuResponseLength`, for request frames (used by the traffic decoder). */
export function rtuRequestLength(buf: Uint8Array): number | null | undefined {
  if (buf.length < 2) return undefined;
  switch (buf[1]) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
    case FC.WRITE_SINGLE_COIL:
    case FC.WRITE_SINGLE_REGISTER:
      return 8;
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return buf.length < 7 ? undefined : 9 + buf[6]!;
    case FC.ENCAPSULATED_INTERFACE:
      return 7;
    default:
      return null;
  }
}

export type RtuResult =
  | { done: false }
  | { done: true; frame: Uint8Array; pdu: Uint8Array }
  | { done: true; frame: Uint8Array; error: ModbusError };

/**
 * Accumulates response chunks for one request. Bytes that arrive after the
 * frame is complete are kept in `extra` so the caller can report them.
 */
export class RtuResponseReader {
  private buf = new Uint8Array(0);
  extra = new Uint8Array(0);

  constructor(private readonly unitId: number) {}

  push(chunk: Uint8Array): RtuResult {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const len = rtuResponseLength(this.buf);
    if (len === undefined) return { done: false };
    if (len === null) {
      return { done: true, frame: this.buf, error: new ModbusError("INVALID_RESPONSE", "unknown function code in response") };
    }
    if (this.buf.length < len) return { done: false };

    const frame = this.buf.subarray(0, len);
    this.extra = this.buf.subarray(len);
    if (!checkCrc(frame)) return { done: true, frame, error: new ModbusError("CRC_ERROR", "CRC mismatch") };
    if (frame[0] !== this.unitId) {
      return {
        done: true,
        frame,
        error: new ModbusError("INVALID_RESPONSE", `response from unit ${frame[0]}, expected ${this.unitId}`),
      };
    }
    return { done: true, frame, pdu: frame.subarray(1, len - 2) };
  }

  /** Bytes received so far, for the traffic monitor on timeout. */
  get received(): Uint8Array {
    return this.buf;
  }
}

/** Bit time and frame time on the wire, for timeouts and cycle estimates. */
export function charTimeMs(baudRate: number, bitsPerChar = 11): number {
  return (bitsPerChar * 1000) / baudRate;
}
