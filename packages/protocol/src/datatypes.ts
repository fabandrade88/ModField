export const DATA_TYPES = ["INT16", "UINT16", "INT32", "UINT32", "FLOAT32", "FLOAT64", "STRING"] as const;
export type DataType = (typeof DATA_TYPES)[number];

/**
 * Byte order of a multi-register value, written as the order in which bytes
 * A (most significant) to D arrive on the wire.
 * - ABCD: big-endian, Modbus standard.
 * - CDAB: registers reversed (word swap).
 * - BADC: bytes swapped inside each register.
 * - DCBA: both.
 * For 64-bit values the same rule applies to all four registers. 16-bit types
 * honor the byte swap only.
 */
export const BYTE_ORDERS = ["ABCD", "CDAB", "BADC", "DCBA"] as const;
export type ByteOrder = (typeof BYTE_ORDERS)[number];

const wordSwap = (o: ByteOrder) => o === "CDAB" || o === "DCBA";
const byteSwap = (o: ByteOrder) => o === "BADC" || o === "DCBA";

export function registerCount(type: DataType, stringLength = 0): number {
  switch (type) {
    case "INT16":
    case "UINT16":
      return 1;
    case "INT32":
    case "UINT32":
    case "FLOAT32":
      return 2;
    case "FLOAT64":
      return 4;
    case "STRING":
      return Math.ceil(stringLength / 2);
  }
}

/** Registers in wire order -> big-endian bytes ABCD... */
function toBigEndian(regs: ArrayLike<number>, order: ByteOrder): Uint8Array {
  const n = regs.length;
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const r = regs[wordSwap(order) ? n - 1 - i : i]! & 0xffff;
    const hi = r >>> 8;
    const lo = r & 0xff;
    out[i * 2] = byteSwap(order) ? lo : hi;
    out[i * 2 + 1] = byteSwap(order) ? hi : lo;
  }
  return out;
}

/** Big-endian bytes -> registers in wire order. Inverse of `toBigEndian`. */
function fromBigEndian(bytes: Uint8Array, order: ByteOrder): number[] {
  const n = bytes.length / 2;
  const regs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = bytes[i * 2]!;
    const b = bytes[i * 2 + 1]!;
    regs[wordSwap(order) ? n - 1 - i : i] = byteSwap(order) ? (b << 8) | a : (a << 8) | b;
  }
  return regs;
}

export function decodeValue(
  regs: ArrayLike<number>,
  type: DataType,
  order: ByteOrder = "ABCD",
): number | string {
  const need = type === "STRING" ? regs.length : registerCount(type);
  if (regs.length < need) throw new RangeError(`${type} needs ${need} registers, got ${regs.length}`);
  const slice = Array.from({ length: need }, (_, i) => regs[i]!);
  // 16-bit types ignore word order (there is only one word).
  const bytes = toBigEndian(slice, order);
  const view = new DataView(bytes.buffer);
  switch (type) {
    case "INT16":
      return view.getInt16(0);
    case "UINT16":
      return view.getUint16(0);
    case "INT32":
      return view.getInt32(0);
    case "UINT32":
      return view.getUint32(0);
    case "FLOAT32":
      return view.getFloat32(0);
    case "FLOAT64":
      return view.getFloat64(0);
    case "STRING": {
      const end = bytes.indexOf(0);
      return new TextDecoder("latin1").decode(end === -1 ? bytes : bytes.subarray(0, end)).trimEnd();
    }
  }
}

export function encodeValue(
  value: number | string,
  type: DataType,
  order: ByteOrder = "ABCD",
  stringLength = 0,
): number[] {
  const n = registerCount(type, stringLength);
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  if (type === "STRING") {
    if (typeof value !== "string") throw new TypeError("STRING needs a string value");
    for (let i = 0; i < Math.min(value.length, bytes.length); i++) bytes[i] = value.charCodeAt(i) & 0xff;
    return fromBigEndian(bytes, order);
  }
  if (typeof value !== "number" || Number.isNaN(value)) throw new TypeError(`${type} needs a number`);
  const int = (min: number, max: number) => {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${value} out of range for ${type} [${min}, ${max}]`);
    }
    return value;
  };
  switch (type) {
    case "INT16":
      view.setInt16(0, int(-0x8000, 0x7fff));
      break;
    case "UINT16":
      view.setUint16(0, int(0, 0xffff));
      break;
    case "INT32":
      view.setInt32(0, int(-0x80000000, 0x7fffffff));
      break;
    case "UINT32":
      view.setUint32(0, int(0, 0xffffffff));
      break;
    case "FLOAT32":
      view.setFloat32(0, value);
      break;
    case "FLOAT64":
      view.setFloat64(0, value);
      break;
  }
  return fromBigEndian(bytes, order);
}

/** Linear scale from raw range to engineering range, e.g. 0..65535 -> 0..10 bar. */
export interface LinearScale {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
}

export function toEngineering(raw: number, s: LinearScale): number {
  if (s.rawMax === s.rawMin) throw new RangeError("rawMin and rawMax must differ");
  return s.engMin + ((raw - s.rawMin) * (s.engMax - s.engMin)) / (s.rawMax - s.rawMin);
}

export function toRaw(eng: number, s: LinearScale): number {
  if (s.engMax === s.engMin) throw new RangeError("engMin and engMax must differ");
  return s.rawMin + ((eng - s.engMin) * (s.rawMax - s.rawMin)) / (s.engMax - s.engMin);
}

export type Radix = "dec" | "hex" | "bin";

/** Formats a raw register (or several) for the hex/bin views: 0x1F2A, 0001 1111 0010 1010. */
export function formatRegister(reg: number, radix: Radix): string {
  switch (radix) {
    case "dec":
      return String(reg);
    case "hex":
      return "0x" + reg.toString(16).toUpperCase().padStart(4, "0");
    case "bin":
      return reg.toString(2).padStart(16, "0").replace(/(.{4})(?!$)/g, "$1 ");
  }
}
