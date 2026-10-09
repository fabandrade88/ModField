import { EXCEPTION_NAMES, FC, isExceptionCode } from "./codes";
import { checkCrc, crc16 } from "./crc";

export type Direction = "tx" | "rx";

export interface FrameSummary {
  unitId: number | undefined;
  fc: number | undefined;
  exception: number | undefined;
  /** Short decoded description: "Read Holding 0..9", "16 bytes", "Exception 02 ILLEGAL DATA ADDRESS". */
  text: string;
  crcOk: boolean | undefined;
}

const NAMES: Record<number, string> = {
  [FC.READ_COILS]: "Read Coils",
  [FC.READ_DISCRETE_INPUTS]: "Read Discrete Inputs",
  [FC.READ_HOLDING_REGISTERS]: "Read Holding",
  [FC.READ_INPUT_REGISTERS]: "Read Input",
  [FC.WRITE_SINGLE_COIL]: "Write Coil",
  [FC.WRITE_SINGLE_REGISTER]: "Write Register",
  [FC.WRITE_MULTIPLE_COILS]: "Write Coils",
  [FC.WRITE_MULTIPLE_REGISTERS]: "Write Registers",
  [FC.ENCAPSULATED_INTERFACE]: "Device Identification",
};

export function functionName(fc: number): string {
  return NAMES[fc & 0x7f] ?? `Function ${fc & 0x7f}`;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Describes an RTU frame for the traffic monitor. Never throws. */
export function describeRtuFrame(frame: Uint8Array, dir: Direction): FrameSummary {
  const unitId = frame[0];
  const fc = frame[1];
  const crcOk = frame.length >= 4 ? checkCrc(frame) : undefined;
  if (fc === undefined) return { unitId, fc, exception: undefined, text: "incomplete frame", crcOk };
  const rd16 = (i: number) => ((frame[i] ?? 0) << 8) | (frame[i + 1] ?? 0);
  const name = functionName(fc);

  if (fc & 0x80) {
    const ex = frame[2];
    const exName = ex !== undefined && isExceptionCode(ex) ? EXCEPTION_NAMES[ex] : "unknown";
    return {
      unitId,
      fc: fc & 0x7f,
      exception: ex,
      text: `${name}: exception ${ex?.toString(16).padStart(2, "0").toUpperCase()} ${exName}`,
      crcOk,
    };
  }
  let text = name;
  if (fc >= 1 && fc <= 4) {
    text += dir === "tx" ? ` @${rd16(2)} ×${rd16(4)}` : `: ${frame[2] ?? 0} bytes`;
  } else if (fc === FC.WRITE_SINGLE_COIL || fc === FC.WRITE_SINGLE_REGISTER) {
    text += ` @${rd16(2)} = ${fc === FC.WRITE_SINGLE_COIL ? (frame[4] === 0xff ? "ON" : "OFF") : rd16(4)}`;
  } else if (fc === FC.WRITE_MULTIPLE_COILS || fc === FC.WRITE_MULTIPLE_REGISTERS) {
    text += ` @${rd16(2)} ×${rd16(4)}`;
  }
  return { unitId, fc, exception: undefined, text, crcOk };
}

export type Framing = "rtu" | "tcp";

/**
 * Describes a Modbus TCP frame (MBAP header + unit + PDU). The summary is the
 * same as for RTU; crcOk is undefined (TCP has no CRC).
 */
export function describeTcpFrame(frame: Uint8Array, dir: Direction): FrameSummary {
  if (frame.length < 8) return { unitId: frame[6], fc: frame[7], exception: undefined, text: "incomplete frame", crcOk: undefined };
  // Reuse the RTU decoder on unit + PDU with a dummy CRC, then drop the CRC verdict.
  const rtuLike = new Uint8Array(frame.length - 6 + 2);
  rtuLike.set(frame.subarray(6));
  const d = describeRtuFrame(rtuLike, dir);
  const tid = ((frame[0] ?? 0) << 8) | (frame[1] ?? 0);
  return { ...d, text: `#${tid} ${d.text}`, crcOk: undefined };
}

export function describeFrame(frame: Uint8Array, dir: Direction, framing: Framing = "rtu"): FrameSummary {
  return framing === "tcp" ? describeTcpFrame(frame, dir) : describeRtuFrame(frame, dir);
}

/** Expected CRC of a frame body, for showing "CRC esperado" next to a bad frame. */
export function expectedCrc(frame: Uint8Array): number {
  return crc16(frame, Math.max(0, frame.length - 2));
}
