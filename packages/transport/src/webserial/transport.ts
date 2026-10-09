import {
  ModbusError,
  RtuResponseReader,
  charTimeMs,
  decodeResponse,
  encodeRequest,
  encodeRtu,
  type ErrorCode,
  type ModbusRequest,
  type ResponseFor,
} from "@modfield/protocol";
import { Emitter } from "../emitter";
import type {
  ConnState,
  RequestOptions,
  Transport,
  TransportEvents,
  TransportKind,
  TransportStats,
} from "../types";
import { describePort, type SerialPortLike } from "./serial-types";

export interface SerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
  /** Minimum silence between the end of one transaction and the next request, ms. */
  interRequestDelayMs: number;
}

export const DEFAULT_SERIAL: SerialSettings = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  interRequestDelayMs: 5,
};

/** "19200 8E1" */
export function formatSerial(s: SerialSettings): string {
  return `${s.baudRate} ${s.dataBits}${s.parity[0]!.toUpperCase()}${s.stopBits}`;
}

interface Pending {
  unitId: number;
  reader: RtuResponseReader;
  resolve: (pdu: Uint8Array) => void;
  reject: (e: ModbusError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function emptyStats(): TransportStats {
  return { requests: 0, timeouts: 0, crcErrors: 0, exceptions: 0, errors: 0, lastRttMs: undefined };
}

/**
 * Modbus RTU master over a Web Serial port. Responses are delimited by their
 * expected length and validated by CRC (see `RtuResponseReader`).
 */
export class WebSerialTransport implements Transport {
  readonly kind: TransportKind = "webserial";
  state: ConnState = "disconnected";
  stats: TransportStats = emptyStats();

  private readonly events = new Emitter<TransportEvents>();
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private lastActivity = 0;
  private readonly onDisconnect = () => this.fail("PORT_DISCONNECTED");

  constructor(
    protected readonly port: SerialPortLike,
    readonly settings: SerialSettings = DEFAULT_SERIAL,
  ) {}

  get label(): string {
    return `${describePort(this.port.getInfo())} · ${formatSerial(this.settings)}`;
  }

  on<K extends keyof TransportEvents>(event: K, cb: (v: TransportEvents[K]) => void): () => void {
    return this.events.on(event, cb);
  }

  private setState(s: ConnState): void {
    this.state = s;
    this.events.emit("state", s);
  }

  async open(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") return;
    this.setState("connecting");
    try {
      await this.port.open({
        baudRate: this.settings.baudRate,
        dataBits: this.settings.dataBits,
        parity: this.settings.parity,
        stopBits: this.settings.stopBits,
        flowControl: "none",
        bufferSize: 4096,
      });
    } catch (e) {
      this.setState("error");
      throw openError(e);
    }
    this.writer = this.port.writable!.getWriter();
    this.reader = this.port.readable!.getReader();
    this.port.addEventListener("disconnect", this.onDisconnect);
    this.stats = emptyStats();
    this.setState("connected");
    void this.readLoop(this.reader);
  }

  async close(): Promise<void> {
    if (this.state === "disconnected") return;
    this.port.removeEventListener("disconnect", this.onDisconnect);
    this.rejectPending(new ModbusError("PORT_DISCONNECTED", "port closed"));
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      await this.writer?.close().catch(() => undefined);
      this.writer?.releaseLock();
      await this.port.close();
    } catch {
      // The port may already be gone (unplugged); closing is best effort.
    }
    this.reader = this.writer = undefined;
    this.setState("disconnected");
  }

  private fail(code: ErrorCode): void {
    this.rejectPending(new ModbusError(code, "serial port lost"));
    this.reader = this.writer = undefined;
    this.setState("error");
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.length) this.onBytes(value);
      }
    } catch {
      if (this.reader === reader) this.fail("PORT_DISCONNECTED");
    }
  }

  private onBytes(chunk: Uint8Array): void {
    this.lastActivity = performance.now();
    const p = this.pending;
    if (!p) {
      // Late reply after a timeout, noise, or another master on the bus.
      this.events.emit("traffic", { t: Date.now(), dir: "rx", bytes: chunk.slice(), error: "INVALID_RESPONSE" });
      return;
    }
    const res = p.reader.push(chunk);
    if (!res.done) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    if ("error" in res) {
      this.events.emit("traffic", { t: Date.now(), dir: "rx", bytes: res.frame.slice(), error: res.error.code });
      p.reject(res.error);
    } else {
      this.events.emit("traffic", { t: Date.now(), dir: "rx", bytes: res.frame.slice() });
      p.resolve(res.pdu.slice());
    }
  }

  private rejectPending(e: ModbusError): void {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    p.reject(e);
  }

  request<R extends ModbusRequest>(unitId: number, req: R, opts: RequestOptions): Promise<ResponseFor<R["fc"]>> {
    const pdu = encodeRequest(req);
    const run = () => this.exchange(unitId, pdu, opts.timeoutMs).then((res) => decodeResponse(req, res));
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result.then(
      (r) => {
        this.count(undefined);
        return r;
      },
      (e: unknown) => {
        this.count(e);
        throw e;
      },
    );
  }

  private count(e: unknown): void {
    this.stats.requests++;
    if (e instanceof ModbusError) {
      if (e.code === "TIMEOUT") this.stats.timeouts++;
      else if (e.code === "CRC_ERROR") this.stats.crcErrors++;
      else if (e.code === "MODBUS_EXCEPTION") this.stats.exceptions++;
      else this.stats.errors++;
    } else if (e) {
      this.stats.errors++;
    }
    this.events.emit("stats", { ...this.stats });
  }

  private async exchange(unitId: number, pdu: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    if (!Number.isInteger(unitId) || unitId < 1 || unitId > 247) {
      throw new RangeError(`unit id must be 1..247, got ${unitId}`);
    }
    const writer = this.writer;
    if (this.state !== "connected" || !writer) throw new ModbusError("PORT_DISCONNECTED", "port not open");

    const charMs = charTimeMs(this.settings.baudRate, 1 + this.settings.dataBits + (this.settings.parity === "none" ? 0 : 1) + this.settings.stopBits);
    const silence = Math.max(this.settings.interRequestDelayMs, 3.5 * charMs);
    const wait = this.lastActivity + silence - performance.now();
    if (wait > 0) await sleep(wait);

    const frame = encodeRtu(unitId, pdu);
    const started = performance.now();
    const response = new Promise<Uint8Array>((resolve, reject) => {
      const reader = new RtuResponseReader(unitId);
      // The timeout starts when the request leaves; add its time on the wire.
      const timer = setTimeout(() => {
        if (this.pending?.reader !== reader) return;
        this.pending = undefined;
        // RX entry with whatever arrived (often nothing), so the monitor shows the gap.
        this.events.emit("traffic", { t: Date.now(), dir: "rx", bytes: reader.received.slice(), error: "TIMEOUT" });
        reject(new ModbusError("TIMEOUT", `unit ${unitId} did not answer within ${timeoutMs} ms`));
      }, timeoutMs + frame.length * charMs);
      this.pending = { unitId, reader, resolve, reject, timer };
    });
    this.events.emit("traffic", { t: Date.now(), dir: "tx", bytes: frame });
    try {
      await writer.write(frame);
    } catch {
      this.fail("PORT_DISCONNECTED");
    }
    this.lastActivity = performance.now();
    try {
      return await response;
    } finally {
      this.lastActivity = performance.now();
      this.stats.lastRttMs = this.lastActivity - started;
    }
  }
}

function openError(e: unknown): ModbusError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  const message = e instanceof Error ? e.message : String(e);
  // Chrome reports "Failed to open serial port" as NetworkError when another program holds it.
  if (name === "NetworkError" || name === "InvalidStateError") return new ModbusError("PORT_BUSY", message);
  if (name === "SecurityError" || name === "NotAllowedError") return new ModbusError("PERMISSION_DENIED", message);
  return new ModbusError("PORT_DISCONNECTED", message);
}
