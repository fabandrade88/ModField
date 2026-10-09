"use client";
import { create } from "zustand";
import {
  MockTransport,
  ModbusClient,
  WebSerialTransport,
  describePort,
  getSerial,
  type ConnState,
  type SerialPortLike,
  type SerialSettings,
  type TrafficFrame,
  type Transport,
  type TransportStats,
} from "@modfield/transport";
import { Ring } from "@/lib/ring";

/** Raw traffic stays in memory only: circular buffer of 50,000 frames. */
export const traffic = new Ring<TrafficFrame>(50_000);

interface ConnectionState {
  transport: Transport | undefined;
  client: ModbusClient | undefined;
  state: ConnState;
  label: string;
  stats: TransportStats | undefined;
  error: unknown;
  /** Bumped (at most once per frame) when traffic arrives, so views re-render. */
  trafficVersion: number;
  timeoutMs: number;
  port: SerialPortLike | undefined;
  portLabel: string | undefined;
  /** Last connection, so Ctrl+Enter reconnects the same way. */
  last: { kind: Transport["kind"]; serial: SerialSettings } | undefined;
  /** True while the scanner owns the port (parameter detection, passive listening). */
  portBusy: boolean;

  setTimeoutMs: (ms: number) => void;
  choosePort: () => Promise<void>;
  connectSerial: (serial: SerialSettings, timeoutMs: number) => Promise<void>;
  connectDemo: (timeoutMs?: number) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Ctrl+Enter. Resolves false when there is nothing to reconnect to. */
  toggle: () => Promise<boolean>;
  clearTraffic: () => void;
  setPortBusy: (busy: boolean) => void;
}

let unsubscribe: (() => void)[] = [];
let bumpScheduled = false;
/** The demo keeps one simulated line across reconnects, so writes survive Ctrl+Enter. */
let demoTransport: MockTransport | undefined;

export function demoLine() {
  demoTransport ??= new MockTransport();
  return demoTransport.line;
}

export const useConnection = create<ConnectionState>()((set, get) => {
  const bump = () => {
    if (bumpScheduled) return;
    bumpScheduled = true;
    requestAnimationFrame(() => {
      bumpScheduled = false;
      set((s) => ({ trafficVersion: s.trafficVersion + 1 }));
    });
  };

  async function attach(transport: Transport, timeoutMs: number, serial: SerialSettings) {
    await get().disconnect();
    unsubscribe = [
      transport.on("state", (state) => set({ state })),
      transport.on("stats", (stats) => set({ stats })),
      transport.on("traffic", (f) => {
        traffic.push(f);
        bump();
      }),
    ];
    const client = new ModbusClient(transport, { timeoutMs });
    set({
      transport,
      client,
      timeoutMs,
      label: transport.label,
      error: undefined,
      stats: undefined,
      state: "connecting",
      last: { kind: transport.kind, serial },
    });
    try {
      await transport.open();
      set({ state: transport.state, stats: { ...transport.stats } });
    } catch (e) {
      set({ error: e, state: "error" });
    }
  }

  return {
    transport: undefined,
    client: undefined,
    state: "disconnected",
    label: "",
    stats: undefined,
    error: undefined,
    trafficVersion: 0,
    timeoutMs: 1000,
    port: undefined,
    portLabel: undefined,
    last: undefined,
    portBusy: false,

    setTimeoutMs: (timeoutMs) => {
      const c = get().client;
      if (c) c.options.timeoutMs = timeoutMs;
      set({ timeoutMs });
    },

    choosePort: async () => {
      const serial = getSerial();
      if (!serial) return;
      try {
        const port = await serial.requestPort();
        set({ port, portLabel: describePort(port.getInfo()) });
      } catch {
        // The user closed the browser's port picker.
      }
    },

    connectSerial: async (serial, timeoutMs) => {
      const { port } = get();
      if (!port) return get().choosePort();
      await attach(new WebSerialTransport(port, { ...serial }), timeoutMs, serial);
    },

    connectDemo: async (timeoutMs = 1000) => {
      demoTransport ??= new MockTransport();
      await attach(demoTransport, timeoutMs, demoTransport.settings);
    },

    disconnect: async () => {
      const t = get().transport;
      unsubscribe.forEach((u) => u());
      unsubscribe = [];
      set({ transport: undefined, client: undefined, state: "disconnected", label: "" });
      await t?.close();
    },

    toggle: async () => {
      const { transport, state, last, port } = get();
      if (transport && (state === "connected" || state === "connecting")) {
        await get().disconnect();
      } else if (last?.kind === "mock") {
        await get().connectDemo(get().timeoutMs);
      } else if (port && last) {
        await get().connectSerial(last.serial, get().timeoutMs);
      } else {
        return false;
      }
      return true;
    },

    clearTraffic: () => {
      traffic.clear();
      set((s) => ({ trafficVersion: s.trafficVersion + 1 }));
    },

    setPortBusy: (portBusy) => set({ portBusy }),
  };
});
