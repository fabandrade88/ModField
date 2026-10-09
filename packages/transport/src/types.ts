import type { Direction, ErrorCode, Framing, ModbusRequest, ResponseFor } from "@modfield/protocol";

export type TransportKind = "webserial" | "agent" | "mock";
export type ConnState = "disconnected" | "connecting" | "connected" | "error";

export interface TrafficFrame {
  /** Epoch ms. */
  t: number;
  dir: Direction;
  bytes: Uint8Array;
  /** Set on RX frames that failed, and on TX frames that got no answer. */
  error?: ErrorCode;
  /** RTU unless it came from a Modbus TCP connection through the agent. */
  framing?: Framing;
}

export interface TransportStats {
  requests: number;
  timeouts: number;
  crcErrors: number;
  exceptions: number;
  errors: number;
  /** Duration of the last completed request, ms. */
  lastRttMs: number | undefined;
}

export interface RequestOptions {
  timeoutMs: number;
  /** Required by the agent for writes (phase 3); ignored by local transports. */
  confirmToken?: string;
}

export interface TransportEvents {
  traffic: TrafficFrame;
  state: ConnState;
  stats: TransportStats;
}

/**
 * One API for every module. Requests are serialized: a bus carries one
 * transaction at a time. A transport never retries a request on its own;
 * writes are not idempotent and retrying is the caller's decision.
 */
export interface Transport {
  readonly kind: TransportKind;
  readonly state: ConnState;
  readonly stats: Readonly<TransportStats>;
  /** Human label: "FTDI 0403:6001 · 19200 8E1", "Demonstração". */
  readonly label: string;
  open(): Promise<void>;
  close(): Promise<void>;
  request<R extends ModbusRequest>(unitId: number, req: R, opts: RequestOptions): Promise<ResponseFor<R["fc"]>>;
  on<K extends keyof TransportEvents>(event: K, cb: (v: TransportEvents[K]) => void): () => void;
}
