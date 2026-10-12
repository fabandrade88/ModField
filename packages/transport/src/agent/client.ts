import { AGENT_PORTS, ERROR_CODES, ModbusError, checkCompatibility, isExceptionCode, type AgentHello, type Compatibility, type ErrorCode } from "@modfield/protocol";
import { Emitter } from "../emitter";
import { fromB64url, randomB64url, toB64url } from "./b64";

/** Pairing credentials kept by the browser (IndexedDB). */
export interface AgentCredentials {
  tokenId: string;
  secret: string;
  /** The agent's Ed25519 key, pinned at pairing: an impostor on the port cannot sign. */
  publicKey: string;
  fingerprint: string;
}

export interface AgentEndpoint {
  port: number;
  hello: AgentHello & { fingerprint: string };
  compatibility: Compatibility;
}

export type WebSocketFactory = (url: string) => WebSocket;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Looks for the agent on its three ports. Each probe is a CORS GET of
 * /v1/hello, which the agent only answers for allowed origins.
 */
export async function discoverAgent(opts: { ports?: readonly number[]; fetch?: FetchLike; timeoutMs?: number } = {}): Promise<AgentEndpoint | undefined> {
  const f = opts.fetch ?? fetch;
  for (const port of opts.ports ?? AGENT_PORTS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 1500);
    try {
      // No targetAddressSpace: asserting one (e.g. "local") hard-fails when it
      // doesn't match Chrome's classification of 127.0.0.1 ("loopback"). Left
      // unset, Chrome infers the space and uses its normal Local Network Access
      // flow (a one-time permission prompt) instead of blocking outright.
      const res = await f(`http://127.0.0.1:${port}/v1/hello`, { signal: ac.signal, cache: "no-store" });
      if (!res.ok) continue;
      const body = (await res.json()) as { result?: AgentEndpoint["hello"] };
      if (!body.result?.publicKey) continue;
      return { port, hello: body.result, compatibility: checkCompatibility(body.result.protocol) };
    } catch {
      // Nothing on this port (or the browser blocked the request).
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const enc = new TextEncoder();

/** Maps a JSON-RPC error from the agent to the same ModbusError the local transports throw. */
export function toModbusError(e: { code: number; message: string; data?: { error?: string; exception?: number; group?: string } }): ModbusError {
  const code = (ERROR_CODES as readonly string[]).includes(e.data?.error ?? "") ? (e.data!.error as ErrorCode) : "INVALID_RESPONSE";
  const ex = e.data?.exception;
  const err = new ModbusError(code, e.message, ex !== undefined && isExceptionCode(ex) ? ex : undefined);
  if (e.data?.group) (err as ModbusError & { group?: string }).group = e.data.group;
  return err;
}

export class AgentAuthError extends Error {
  constructor(
    readonly reason: "impostor" | "rejected",
    message: string,
  ) {
    super(message);
  }
}

/** JSON-RPC 2.0 over ws://127.0.0.1:<port>/v1. */
export class AgentClient {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readonly events = new Emitter<{ notification: { method: string; params: unknown }; close: void }>();
  authenticated = false;

  constructor(
    readonly endpoint: AgentEndpoint,
    private readonly factory: WebSocketFactory = (url) => new WebSocket(url),
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.factory(`ws://127.0.0.1:${this.endpoint.port}/v1`);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new ModbusError("CONN_REFUSED", "agent WebSocket failed"));
      ws.onclose = () => {
        this.authenticated = false;
        for (const p of this.pending.values()) p.reject(new ModbusError("PORT_DISCONNECTED", "agent connection closed"));
        this.pending.clear();
        this.events.emit("close", undefined);
      };
      ws.onmessage = (ev) => this.onMessage(String(ev.data));
    });
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: Parameters<typeof toModbusError>[0]; method?: string; params?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(toModbusError(msg.error));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.events.emit("notification", { method: msg.method, params: msg.params });
    }
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new ModbusError("PORT_DISCONNECTED", "agent not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  on<K extends "notification" | "close">(event: K, cb: (v: K extends "notification" ? { method: string; params: unknown } : void) => void): () => void {
    return this.events.on(event, cb as never);
  }

  close(): void {
    this.ws?.close();
  }

  /**
   * Mutual authentication. First the agent proves its identity by signing our
   * nonce with the key pinned at pairing; only then do we prove the token,
   * with an HMAC (the secret never travels).
   */
  async authenticate(cred: AgentCredentials, origin: string): Promise<void> {
    if (cred.publicKey !== this.endpoint.hello.publicKey) {
      throw new AgentAuthError("impostor", "the agent on this port has a different key than the one paired");
    }
    const nonce = randomB64url();
    const { agentNonce, signature } = await this.call<{ agentNonce: string; signature: string }>("agent.challenge", { nonce });
    const key = await crypto.subtle.importKey("raw", fromB64url(cred.publicKey), { name: "Ed25519" }, false, ["verify"]);
    const signed = enc.encode(`modfield-agent-auth:v1:${origin}:${nonce}:${agentNonce}`);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(signature), signed))) {
      throw new AgentAuthError("impostor", "agent signature does not match the paired key");
    }
    const hmacKey = await crypto.subtle.importKey("raw", fromB64url(cred.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(`modfield-browser-auth:v1:${agentNonce}:${nonce}`)));
    try {
      await this.call("agent.auth", { tokenId: cred.tokenId, mac: toB64url(mac) });
    } catch (e) {
      throw new AgentAuthError("rejected", e instanceof Error ? e.message : String(e));
    }
    this.authenticated = true;
  }

  /** Starts pairing: the agent opens a local page with a 6-digit code. */
  beginPairing(name: string): Promise<{ requestId: string; pairUrl: string }> {
    return this.call("pair.begin", { name });
  }

  async completePairing(requestId: string, code: string): Promise<AgentCredentials> {
    const r = await this.call<AgentCredentials>("pair.complete", { requestId, code });
    if (r.publicKey !== this.endpoint.hello.publicKey) throw new AgentAuthError("impostor", "pairing answered with a different key");
    return r;
  }
}
