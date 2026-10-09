/** CRC-16/MODBUS: poly 0xA001 (reflected 0x8005), init 0xFFFF. */
const TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc16(bytes: Uint8Array, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) crc = (crc >>> 8) ^ TABLE[(crc ^ bytes[i]!) & 0xff]!;
  return crc;
}

/** On the wire the CRC goes low byte first. */
export function withCrc(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 2);
  out.set(body);
  const crc = crc16(body);
  out[body.length] = crc & 0xff;
  out[body.length + 1] = crc >>> 8;
  return out;
}

export function checkCrc(frame: Uint8Array): boolean {
  if (frame.length < 4) return false;
  const n = frame.length - 2;
  return crc16(frame, n) === (frame[n]! | (frame[n + 1]! << 8));
}
