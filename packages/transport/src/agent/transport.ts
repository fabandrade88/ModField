import { FC, ModbusError, type ModbusRequest, type ResponseFor } from "@modfield/protocol";
import { Emitter } from "../emitter";
import type { ConnState, RequestOptions, Transport, TransportEvents, TransportKind, TransportStats } from "../types";
import { fromHex } from "./b64";
import type { AgentClient } from "./client";

/** conn.open parameters, as the agent expects them. */
export type AgentConnParams =
  | {
      kind: "rtu";
      port: string;
      baudRate: number;
      dataBits: number;
      parity: "none" | "even" | "odd";
      stopBits: number;
      interRequestDelayMs: number;
    }
  | { kind: "tcp"; host: string; tcpPort: number };

interface AgentResponse {
  fc: number;
  registers?: number[];
  bits?: boolean[];
  address?: number;
  value?: number;
  quantity?: number;
  readCode?: number;
  conformity?: number;
  moreFollows?: boolean;
  nextObjectId?: number;
  objects?: Record<string, string>;
}

/** The agent's request shape: coils as 0xFF00/0 and bit lists in `bits`. */
function toAgentRequest(req: ModbusRequest): Record<string, unknown> {
  switch (req.fc) {
    case FC.WRITE_SINGLE_COIL:
      return { fc: req.fc, address: req.address, value: req.value ? 0xff00 : 0 };
    case FC.WRITE_MULTIPLE_COILS:
      return { fc: req.fc, address: req.address, bits: req.values };
    case FC.ENCAPSULATED_INTERFACE:
      return { fc: req.fc, readCode: req.readCode, objectId: req.objectId };
    default:
      return { ...req };
  }
}

function fromAgentResponse(req: ModbusRequest, r: AgentResponse): unknown {
  switch (req.fc) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
      return { fc: req.fc, bits: r.bits ?? [] };
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return { fc: req.fc, registers: r.registers ?? [] };
    case FC.WRITE_SINGLE_COIL:
      return { fc: req.fc, address: r.address ?? req.address, value: r.value === 0xff00 };
    case FC.WRITE_SINGLE_REGISTER:
      return { fc: req.fc, address: r.address ?? req.address, value: r.value ?? 0 };
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return { fc: req.fc, address: r.address ?? req.address, quantity: r.quantity ?? 0 };
    case FC.ENCAPSULATED_INTERFACE:
      return {
        fc: req.fc,
        readCode: r.readCode ?? req.readCode,
        conformity: r.conformity ?? 0,
        moreFollows: r.moreFollows ?? false,
        nextObjectId: r.nextObjectId ?? 0,
        objects: Object.fromEntries(Object.entries(r.objects ?? {}).map(([k, v]) => [Number(k), v])),
      };
  }
}

const isWrite = (fc: number) => [FC.WRITE_SINGLE_COIL, FC.WRITE_SINGLE_REGISTER, FC.WRITE_MULTIPLE_COILS, FC.WRITE_MULTIPLE_REGISTERS].includes(fc as never);

/**
 * RTU or TCP through the local agent. Same Transport API as Web Serial, so
 * every module works unchanged; the agent never retries either.
 */
export class AgentTransport implements Transport {
  readonly kind: TransportKind = "agent";
  state: ConnState = "disconnected";
  stats: TransportStats = { requests: 0, timeouts: 0, crcErrors: 0, exceptions: 0, errors: 0, lastRttMs: undefined };
  connId: string | undefined;
  private agentLabel = "";
  private readonly events = new Emitter<TransportEvents>();
  private offs: (() => void)[] = [];

  constructor(
    readonly agent: AgentClient,
    readonly params: AgentConnParams,
  ) {}

  get label(): string {
    return `Agente · ${this.agentLabel || (this.params.kind === "tcp" ? `TCP ${this.params.host}:${this.params.tcpPort}` : this.params.port)}`;
  }

  get framing(): "rtu" | "tcp" {
    return this.params.kind;
  }

  on<K extends keyof TransportEvents>(event: K, cb: (v: TransportEvents[K]) => void): () => void {
    return this.events.on(event, cb);
  }

  private setState(s: ConnState): void {
    this.state = s;
    this.events.emit("state", s);
  }

  async open(): Promise<void> {
    this.setState("connecting");
    try {
      const r = await this.agent.call<{ connId: string; label: string }>("conn.open", this.params);
      this.connId = r.connId;
      this.agentLabel = r.label;
      this.offs.push(
        this.agent.on("notification", (n) => {
          if (n.method !== "traffic.frame") return;
          const f = n.params as { connId: string; t: number; dir: "tx" | "rx"; bytes: string; error?: string; framing: "rtu" | "tcp" };
          if (f.connId !== this.connId) return;
          this.events.emit("traffic", { t: f.t, dir: f.dir, bytes: fromHex(f.bytes), error: f.error as never, framing: f.framing });
        }),
        this.agent.on("close", () => this.setState("error")),
      );
      await this.agent.call("traffic.subscribe", { connId: this.connId });
      this.setState("connected");
    } catch (e) {
      this.setState("error");
      throw e;
    }
  }

  async close(): Promise<void> {
    this.offs.forEach((o) => o());
    this.offs = [];
    if (this.connId) await this.agent.call("conn.close", { connId: this.connId }).catch(() => undefined);
    this.connId = undefined;
    this.setState("disconnected");
  }

  async request<R extends ModbusRequest>(unitId: number, req: R, opts: RequestOptions): Promise<ResponseFor<R["fc"]>> {
    if (!this.connId) throw new ModbusError("PORT_DISCONNECTED", "not connected");
    const started = performance.now();
    try {
      const write = isWrite(req.fc);
      const r = await this.agent.call<AgentResponse>(write ? "modbus.write" : "modbus.read", {
        connId: this.connId,
        unitId,
        request: toAgentRequest(req),
        timeoutMs: opts.timeoutMs,
        confirmToken: write ? opts.confirmToken : undefined,
      });
      this.count(undefined, started);
      return fromAgentResponse(req, r) as ResponseFor<R["fc"]>;
    } catch (e) {
      this.count(e, started);
      throw e;
    }
  }

  private count(e: unknown, started: number): void {
    this.stats.requests++;
    this.stats.lastRttMs = performance.now() - started;
    if (e instanceof ModbusError) {
      if (e.code === "TIMEOUT") this.stats.timeouts++;
      else if (e.code === "CRC_ERROR") this.stats.crcErrors++;
      else if (e.code === "MODBUS_EXCEPTION") this.stats.exceptions++;
      else this.stats.errors++;
    } else if (e) this.stats.errors++;
    this.events.emit("stats", { ...this.stats });
  }
}
