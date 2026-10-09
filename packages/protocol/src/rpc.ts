import type { ErrorCode } from "./codes";

/** Browser <-> agent protocol (JSON-RPC 2.0 over ws://127.0.0.1:47807/v1). */
export const PROTOCOL_VERSION = { major: 1, minor: 0 } as const;
export const AGENT_PORTS = [47807, 47808, 47809] as const;

export interface RpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: P;
}

export interface RpcNotification<P = unknown> {
  jsonrpc: "2.0";
  method: string;
  params: P;
}

export interface RpcErrorObject {
  code: number;
  message: string;
  data: { error: ErrorCode; exception?: number };
}

export type RpcResponse<R = unknown> =
  | { jsonrpc: "2.0"; id: number; result: R }
  | { jsonrpc: "2.0"; id: number; error: RpcErrorObject };

export interface AgentHello {
  agentVersion: string;
  protocol: { major: number; minor: number };
  features: string[];
  /** Ed25519 public key, base64url. Pinned by the browser at pairing time. */
  publicKey: string;
}

export type Compatibility = "ok" | "degraded" | "blocked";

/** Major mismatch blocks; minor mismatch works with feature detection. */
export function checkCompatibility(agent: { major: number; minor: number }): Compatibility {
  if (agent.major !== PROTOCOL_VERSION.major) return "blocked";
  return agent.minor === PROTOCOL_VERSION.minor ? "ok" : "degraded";
}
