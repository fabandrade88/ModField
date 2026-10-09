import { checkCrc, encodeRtu, rtuRequestLength } from "@modfield/protocol";
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
}

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
  private readonly opts: Required<SimulatedLineOptions>;
  /** Requests heard on the line, newest last; the demo shows them as the "slave log". */
  readonly log: { t: number; unitId: number; frame: Uint8Array }[] = [];

  constructor(slaves: SimSlave[], opts: SimulatedLineOptions = {}) {
    super();
    this.slaves = new Map(slaves.map((s) => [s.unitId, s]));
    this.opts = { latencyMs: 8, chunkSize: 16, corruptRate: 0, rand: Math.random, ...opts };
  }

  getInfo(): SerialPortInfo {
    return {};
  }

  async open(_options: SerialOptions): Promise<void> {
    if (this.readable) throw new DOMException("The port is already open.", "InvalidStateError");
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.controller = c;
      },
    });
    this.writable = new WritableStream<Uint8Array>({ write: (chunk) => this.onWrite(chunk) });
  }

  async close(): Promise<void> {
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

  private answer(frame: Uint8Array): void {
    const unitId = frame[0]!;
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
    setTimeout(() => {
      for (let i = 0; i < response.length; i += this.opts.chunkSize) {
        this.controller?.enqueue(response.slice(i, i + this.opts.chunkSize));
      }
    }, this.opts.latencyMs);
  }
}
