import { FC, checkCrc, encodeRequest, encodeRtu, rtuRequestLength } from "@modfield/protocol";
import type { SerialOptions, SerialPortInfo, SerialPortLike } from "../webserial/serial-types";
import type { SimSlave } from "./slave";

export interface SimulatedLineOptions {
  /** Slave turnaround time before it starts answering, ms. */
  latencyMs?: number;
  /** Split responses into chunks of at most this many bytes, like a USB converter does. */
  chunkSize?: number;
  /** Probability (0..1) of flipping a bit in a response, to exercise CRC errors. */
  corruptRate?: number;
  rand?: () => number;
  /**
   * The settings the slaves really use. A master that opens the port with
   * different ones gets silence (the slaves see framing errors) and reads
   * garbage. Default: 19200 8E1, the demo bench.
   */
  line?: Required<Pick<SerialOptions, "baudRate" | "dataBits" | "parity" | "stopBits">>;
  /** Simulates another master polling the bus every N ms, for passive listening. */
  chatterMs?: number;
}

export const DEMO_LINE = { baudRate: 19200, dataBits: 8, parity: "even", stopBits: 1 } as const;

/**
 * A serial line with simulated slaves on it. Implements the Web Serial port
 * shape, so `WebSerialTransport` runs its real RTU code against it: framing,
 * CRC, timeouts and chunked delivery.
 */
export class SimulatedSerialPort extends EventTarget implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private rx = new Uint8Array(0);
  private readonly slaves: Map<number, SimSlave>;
  private readonly opts: Required<Omit<SimulatedLineOptions, "chatterMs">> & { chatterMs: number | undefined };
  private matches = true;
  private chatter: ReturnType<typeof setInterval> | undefined;
  /** Requests heard on the line, newest last; the demo shows them as the "slave log". */
  readonly log: { t: number; unitId: number; frame: Uint8Array }[] = [];

  constructor(slaves: SimSlave[], opts: SimulatedLineOptions = {}) {
    super();
    this.slaves = new Map(slaves.map((s) => [s.unitId, s]));
    this.opts = { latencyMs: 8, chunkSize: 16, corruptRate: 0, rand: Math.random, line: DEMO_LINE, chatterMs: undefined, ...opts };
  }

  getInfo(): SerialPortInfo {
    return {};
  }

  async open(options: SerialOptions): Promise<void> {
    if (this.readable) throw new DOMException("The port is already open.", "InvalidStateError");
    const l = this.opts.line;
    this.matches =
      options.baudRate === l.baudRate &&
      (options.dataBits ?? 8) === l.dataBits &&
      (options.parity ?? "none") === l.parity &&
      (options.stopBits ?? 1) === l.stopBits;
    if (this.opts.chatterMs) this.chatter = setInterval(() => this.chat(), this.opts.chatterMs);
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    this.writable = new WritableStream<Uint8Array>({ write: (chunk) => this.onWrite(chunk) });
  }

  async close(): Promise<void> {
    clearInterval(this.chatter);
    try {
      this.controller?.close();
    } catch {
      // Already closed by the reader's cancel().
    }
    this.readable = this.writable = null;
    this.controller = undefined;
    this.rx = new Uint8Array(0);
  }

  /** Simulates pulling the USB cable. */
  unplug(): void {
    this.controller?.error(new DOMException("The device has been lost.", "NetworkError"));
    this.dispatchEvent(new Event("disconnect"));
  }

  private onWrite(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.rx.length + chunk.length);
    merged.set(this.rx);
    merged.set(chunk, this.rx.length);
    this.rx = merged;
    for (;;) {
      const len = rtuRequestLength(this.rx);
      if (len === undefined || this.rx.length < (len ?? 0)) return;
      if (len === null) {
        this.rx = new Uint8Array(0); // garbage: real slaves resync on silence
        return;
      }
      const frame = this.rx.slice(0, len);
      this.rx = this.rx.slice(len);
      this.answer(frame);
    }
  }

  /** Bytes as the master sees them: intact if its settings match the line, garbage otherwise. */
  private heard(bytes: Uint8Array): Uint8Array {
    if (this.matches) return bytes;
    return bytes.map((b, i) => (b * 7 + i * 13 + 0x5a) & 0xff);
  }

  private deliver(bytes: Uint8Array): void {
    const out = this.heard(bytes);
    for (let i = 0; i < out.length; i += this.opts.chunkSize) {
      this.controller?.enqueue(out.slice(i, i + this.opts.chunkSize));
    }
  }

  /** The other master reads the first point of a random slave; we hear both frames. */
  private chat(): void {
    const slaves = [...this.slaves.values()];
    const slave = slaves[Math.floor(this.opts.rand() * slaves.length)];
    const point = slave?.config.points.find((p) => p.table === "holding" || p.table === "input");
    if (!slave || !point) return;
    const fc = point.table === "holding" ? FC.READ_HOLDING_REGISTERS : FC.READ_INPUT_REGISTERS;
    const req = encodeRequest({ fc, address: point.address, quantity: 1 });
    this.deliver(encodeRtu(slave.unitId, req));
    setTimeout(() => this.deliver(encodeRtu(slave.unitId, slave.handle(req))), this.opts.latencyMs);
  }

  private answer(frame: Uint8Array): void {
    const unitId = frame[0]!;
    // Wrong baud rate or parity: the slaves never see a valid frame.
    if (!this.matches) return;
    this.log.push({ t: Date.now(), unitId, frame });
    if (this.log.length > 1000) this.log.shift();
    const slave = this.slaves.get(unitId);
    // Wrong CRC or unknown unit: a real slave stays silent, the master times out.
    if (!slave || !checkCrc(frame)) return;
    const response = encodeRtu(unitId, slave.handle(frame.subarray(1, -2)));
    if (this.opts.rand() < this.opts.corruptRate) {
      const i = 1 + Math.floor(this.opts.rand() * (response.length - 1));
      response[i]! ^= 0x01;
    }
    setTimeout(() => this.deliver(response), this.opts.latencyMs);
  }
}
