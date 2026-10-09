import { FC, ModbusError, findFrames, type FoundFrame, type ModbusRequest, type Table } from "@modfield/protocol";
import type { ModbusClient } from "./client";
import type { Transport } from "./types";
import type { SerialPortLike } from "./webserial/serial-types";
import { WebSerialTransport, type SerialSettings } from "./webserial/transport";

export type LineSettings = Pick<SerialSettings, "baudRate" | "dataBits" | "parity" | "stopBits">;

export const COMMON_IDS = [1, 2, 247];

/** Most common IDs first, then the rest of the range in order. */
export function idScanOrder(from = 1, to = 247): number[] {
  const first = COMMON_IDS.filter((id) => id >= from && id <= to);
  const rest: number[] = [];
  for (let id = from; id <= to; id++) if (!first.includes(id)) rest.push(id);
  return [...first, ...rest];
}

/** Short scan timeout by baud rate: 50 ms at 115200 up to 150 ms at 1200. */
export function scanTimeoutMs(baudRate: number): number {
  if (baudRate >= 38400) return 50;
  if (baudRate >= 19200) return 60;
  if (baudRate >= 9600) return 80;
  if (baudRate >= 4800) return 100;
  if (baudRate >= 2400) return 120;
  return 150;
}

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

/** The usual suspects first (as in the field), then every other combination. */
export function serialCandidates(): LineSettings[] {
  const s = (baudRate: number, parity: LineSettings["parity"], stopBits: 1 | 2 = 1): LineSettings => ({
    baudRate,
    dataBits: 8,
    parity,
    stopBits,
  });
  const common = [s(9600, "none"), s(19200, "even"), s(9600, "even"), s(19200, "none"), s(38400, "none"), s(115200, "none")];
  const key = (c: LineSettings) => `${c.baudRate}${c.parity}${c.stopBits}`;
  const seen = new Set(common.map(key));
  const rest: LineSettings[] = [];
  for (const b of BAUDS)
    for (const [p, stop] of [["none", 1], ["even", 1], ["odd", 1], ["none", 2]] as const) {
      const c = s(b, p, stop);
      if (!seen.has(key(c))) rest.push(c);
    }
  return [...common, ...rest];
}

export interface ScanHit {
  unitId: number;
  /** An exception still proves a slave is there. */
  answer: "ok" | "exception";
  exception?: number;
}

/** Any reply proves a slave; holding register 0 is the cheapest probe that most devices answer. */
const PROBE: ModbusRequest = { fc: FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 };

async function probe(t: Transport, unitId: number, timeoutMs: number): Promise<ScanHit | undefined> {
  try {
    await t.request(unitId, PROBE, { timeoutMs });
    return { unitId, answer: "ok" };
  } catch (e) {
    if (e instanceof ModbusError && e.code === "MODBUS_EXCEPTION") return { unitId, answer: "exception", exception: e.exception };
    if (e instanceof ModbusError && e.code === "PORT_DISCONNECTED") throw e;
    return undefined;
  }
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

export async function scanIds(
  t: Transport,
  opts: { ids: number[]; timeoutMs: number; signal?: AbortSignal; onProgress?: (p: Progress, hits: ScanHit[]) => void },
): Promise<ScanHit[]> {
  const hits: ScanHit[] = [];
  for (const [i, id] of opts.ids.entries()) {
    if (opts.signal?.aborted) break;
    const hit = await probe(t, id, opts.timeoutMs);
    if (hit) hits.push(hit);
    opts.onProgress?.({ done: i + 1, total: opts.ids.length, label: `ID ${id}` }, hits);
  }
  return hits.sort((a, b) => a.unitId - b.unitId);
}

export const formatLine = (s: LineSettings) => `${s.baudRate} ${s.dataBits}${s.parity[0]!.toUpperCase()}${s.stopBits}`;

/**
 * Tries each candidate setting until a slave answers. The port is reopened
 * for every combination, so it must not be in use by another transport.
 */
export async function detectSerial(
  port: SerialPortLike,
  opts: {
    ids: number[];
    candidates?: LineSettings[];
    signal?: AbortSignal;
    onProgress?: (p: Progress) => void;
  },
): Promise<{ settings: LineSettings; hit: ScanHit } | undefined> {
  const candidates = opts.candidates ?? serialCandidates();
  for (const [i, c] of candidates.entries()) {
    if (opts.signal?.aborted) return undefined;
    opts.onProgress?.({ done: i, total: candidates.length, label: formatLine(c) });
    const t = new WebSerialTransport(port, { ...c, interRequestDelayMs: 5 });
    await t.open();
    try {
      for (const id of opts.ids) {
        const hit = await probe(t, id, scanTimeoutMs(c.baudRate) * 2);
        if (hit) return { settings: c, hit };
      }
    } finally {
      await t.close();
    }
  }
  opts.onProgress?.({ done: candidates.length, total: candidates.length, label: "" });
  return undefined;
}

/** Listens without transmitting and returns the CRC-valid frames heard. */
export async function sniff(port: SerialPortLike, settings: LineSettings, ms: number, signal?: AbortSignal): Promise<FoundFrame[]> {
  await port.open({ ...settings, flowControl: "none", bufferSize: 8192 });
  const reader = port.readable!.getReader();
  const chunks: Uint8Array[] = [];
  const stop = setTimeout(() => void reader.cancel(), ms);
  const onAbort = () => void reader.cancel();
  signal?.addEventListener("abort", onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // Cancelled or port lost: return what was heard.
  } finally {
    clearTimeout(stop);
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return findFrames(all);
}

/** Passive detection: the first setting under which at least `minFrames` valid frames are heard. */
export async function detectPassive(
  port: SerialPortLike,
  opts: { msPerCandidate: number; minFrames?: number; candidates?: LineSettings[]; signal?: AbortSignal; onProgress?: (p: Progress) => void },
): Promise<{ settings: LineSettings; frames: FoundFrame[] } | undefined> {
  const candidates = opts.candidates ?? serialCandidates();
  for (const [i, c] of candidates.entries()) {
    if (opts.signal?.aborted) return undefined;
    opts.onProgress?.({ done: i, total: candidates.length, label: formatLine(c) });
    const frames = await sniff(port, c, opts.msPerCandidate, opts.signal);
    if (frames.length >= (opts.minFrames ?? 2)) return { settings: c, frames };
  }
  return undefined;
}

export interface AddressRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * Reads blocks of `blockSize`; a block that answers an exception is split in
 * halves down to single addresses, so isolated holes are found with few requests.
 */
export async function discoverRegisters(
  client: ModbusClient,
  opts: {
    unitId: number;
    table: Table;
    from: number;
    to: number;
    blockSize?: number;
    signal?: AbortSignal;
    onProgress?: (p: Progress, found: AddressRange[]) => void;
  },
): Promise<AddressRange[]> {
  const size = opts.blockSize ?? 16;
  const ok: number[] = [];
  const read = async (start: number, qty: number): Promise<boolean> => {
    try {
      if (opts.table === "coil" || opts.table === "discrete") await client.readBits(opts.unitId, opts.table, start, qty);
      else await client.readRegisters(opts.unitId, opts.table, start, qty);
      return true;
    } catch (e) {
      if (e instanceof ModbusError && e.code === "MODBUS_EXCEPTION") return false;
      throw e;
    }
  };
  const explore = async (start: number, qty: number): Promise<void> => {
    if (opts.signal?.aborted) return;
    if (await read(start, qty)) {
      for (let a = start; a < start + qty; a++) ok.push(a);
    } else if (qty > 1) {
      const half = Math.ceil(qty / 2);
      await explore(start, half);
      await explore(start + half, qty - half);
    }
  };
  const total = opts.to - opts.from + 1;
  for (let start = opts.from; start <= opts.to; start += size) {
    if (opts.signal?.aborted) break;
    await explore(start, Math.min(size, opts.to - start + 1));
    opts.onProgress?.({ done: Math.min(total, start - opts.from + size), total, label: `${start}` }, toRanges(ok));
  }
  return toRanges(ok);
}

export function toRanges(addresses: number[]): AddressRange[] {
  const sorted = [...new Set(addresses)].sort((a, b) => a - b);
  const out: AddressRange[] = [];
  for (const a of sorted) {
    const last = out[out.length - 1];
    if (last && a === last.end + 1) last.end = a;
    else out.push({ start: a, end: a });
  }
  return out;
}
