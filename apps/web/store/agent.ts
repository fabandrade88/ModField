"use client";
import { create } from "zustand";
import { AGENT_PORTS } from "@modfield/protocol";
import { AgentAuthError, AgentClient, discoverAgent, type AgentEndpoint } from "@modfield/transport";
import { db } from "@/lib/db";

export type AgentStatus =
  | "idle"
  | "searching"
  | "absent"
  | "found" // answers, not paired
  | "pairing"
  | "paired"
  | "impostor" // something on the port with another key
  | "incompatible"
  | "rejected"; // token revoked or unknown

export interface AgentSerialPort {
  name: string;
  isUsb: boolean;
  vid?: string;
  pid?: string;
  product?: string;
}

interface AgentState {
  status: AgentStatus;
  endpoint: AgentEndpoint | undefined;
  client: AgentClient | undefined;
  pairRequest: string | undefined;
  pairError: string | undefined;
  serialPorts: AgentSerialPort[];
  error: string | undefined;

  discover: () => Promise<void>;
  beginPairing: () => Promise<void>;
  completePairing: (code: string) => Promise<boolean>;
  forget: () => Promise<void>;
  refreshPorts: () => Promise<void>;
}

/** The UI served by the agent itself talks to its own port first. */
function ports(): readonly number[] {
  if (typeof location === "undefined") return AGENT_PORTS;
  const own = Number(location.port);
  return location.hostname === "127.0.0.1" && AGENT_PORTS.includes(own as never) ? [own, ...AGENT_PORTS.filter((p) => p !== own)] : AGENT_PORTS;
}

function browserName(): string {
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${name}${os ? ` · ${os}` : ""}`;
}

export const useAgent = create<AgentState>()((set, get) => {
  const authenticate = async (client: AgentClient): Promise<void> => {
    const cred = await db.agent.get("pairing");
    if (!cred) {
      set({ status: "found" });
      return;
    }
    try {
      await client.authenticate(cred, location.origin);
      set({ status: "paired" });
      void get().refreshPorts();
    } catch (e) {
      set({ status: e instanceof AgentAuthError && e.reason === "impostor" ? "impostor" : "rejected", error: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    status: "idle",
    endpoint: undefined,
    client: undefined,
    pairRequest: undefined,
    pairError: undefined,
    serialPorts: [],
    error: undefined,

    discover: async () => {
      get().client?.close();
      set({ status: "searching", error: undefined, client: undefined });
      const endpoint = await discoverAgent({ ports: ports() });
      if (!endpoint) return set({ status: "absent", endpoint: undefined });
      if (endpoint.compatibility === "blocked") return set({ status: "incompatible", endpoint });
      const client = new AgentClient(endpoint);
      try {
        await client.connect();
      } catch {
        return set({ status: "absent", endpoint: undefined });
      }
      client.on("close", () => {
        if (get().client === client) set({ status: "idle", client: undefined });
      });
      set({ endpoint, client });
      await authenticate(client);
    },

    beginPairing: async () => {
      const { client } = get();
      if (!client) return;
      set({ pairError: undefined });
      const r = await client.beginPairing(browserName());
      set({ status: "pairing", pairRequest: r.requestId });
    },

    completePairing: async (code) => {
      const { client, pairRequest } = get();
      if (!client || !pairRequest) return false;
      try {
        const cred = await client.completePairing(pairRequest, code.trim());
        await db.agent.put({ id: "pairing", ...cred, pairedAt: Date.now() });
        set({ pairRequest: undefined, pairError: undefined });
        await authenticate(client);
        return true;
      } catch (e) {
        set({ pairError: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },

    forget: async () => {
      await db.agent.delete("pairing");
      get().client?.close();
      set({ status: "idle", client: undefined, endpoint: undefined, serialPorts: [] });
    },

    refreshPorts: async () => {
      const { client } = get();
      if (!client?.authenticated) return;
      set({ serialPorts: await client.call<AgentSerialPort[]>("serial.list").catch(() => []) });
    },
  };
});

/**
 * Reconnect silently on load when already paired (the browser granted local
 * network access before). Never while a client exists or a search runs: the
 * user may have paired in the meantime, and discover() would close that client.
 */
export async function autoConnectAgent(): Promise<void> {
  const busy = () => useAgent.getState().client !== undefined || useAgent.getState().status !== "idle";
  if (busy()) return;
  const paired = await db.agent.get("pairing");
  if (paired && !busy()) await useAgent.getState().discover();
}
