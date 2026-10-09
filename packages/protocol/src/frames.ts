import { checkCrc } from "./crc";
import { rtuRequestLength, rtuResponseLength } from "./rtu";

export interface FoundFrame {
  start: number;
  frame: Uint8Array;
  kind: "request" | "response";
}

/**
 * Finds CRC-valid RTU frames in a raw byte capture, for passive listening on
 * a bus that already has a master. Tries every offset, so garbage between
 * frames (wrong baud rate, noise) is skipped.
 */
export function findFrames(bytes: Uint8Array): FoundFrame[] {
  const found: FoundFrame[] = [];
  let i = 0;
  while (i < bytes.length - 3) {
    const rest = bytes.subarray(i);
    let hit: FoundFrame | undefined;
    for (const kind of ["request", "response"] as const) {
      const len = kind === "request" ? rtuRequestLength(rest) : rtuResponseLength(rest);
      if (typeof len === "number" && len >= 4 && len <= rest.length && rest[0]! >= 1 && rest[0]! <= 247) {
        const frame = rest.subarray(0, len);
        if (checkCrc(frame)) {
          hit = { start: i, frame: frame.slice(), kind };
          break;
        }
      }
    }
    if (hit) {
      found.push(hit);
      i += hit.frame.length;
    } else {
      i++;
    }
  }
  return found;
}
