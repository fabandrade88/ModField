"use client";
import { create } from "zustand";
import {
  DEFAULT_SERIAL,
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
  serial: SerialSettings;
  timeoutMs: number;
  port: SerialPortLike | undefined;
  portLabel: string | undefined;
  /** Kind of the last connection, so Ctrl+Enter reconnects the same way. */
  lastKind: Transport["kind"] | undefined;

  setSerial: (patch: Partial<SerialSettings>) => void;
  setTimeoutMs: (ms: number) => void;
  choosePort: () => Promise<void>;
  connectSerial: () => Promise<void>;
  connectDemo: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Ctrl+Enter. Resolves false when there is nothing to reconnect to. */
  toggle: () => Promise<boolean>;
  clearTraffic: () => void;
}

let unsubscribe: (() => void)[] = [];
let bumpScheduled = false;

export const useConnection = create<ConnectionState>()((set, get) => {
  const bump = () => {
    if (bumpScheduled) return;
    bumpScheduled = true;
    requestAnimationFrame(() => {
      bumpScheduled = false;
      set((s) => ({ trafficVersion: s.trafficVersion + 1 }));
    });
  };

  async function attach(transport: Transport) {
    await get().disconnect();
    unsubscribe = [
      transport.on("state", (state) => set({ state })),
      transport.on("stats", (stats) => set({ stats })),
      transport.on("traffic", (f) => {
        traffic.push(f);
        bump();
      }),
    ];
    const client = new ModbusClient(transport, { timeoutMs: get().timeoutMs });
    set({ transport, client, label: transport.label, error: undefined, stats: undefined, state: "connecting", lastKind: transport.kind });
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
    serial: { ...DEFAULT_SERIAL },
    timeoutMs: 1000,
    port: undefined,
    portLabel: undefined,
    lastKind: undefined,

    setSerial: (patch) => set((s) => ({ serial: { ...s.serial, ...patch } })),
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

    connectSerial: async () => {
      const { port, serial } = get();
      if (!port) return get().choosePort();
      await attach(new WebSerialTransport(port, { ...serial }));
    },

    connectDemo: () => attach(new MockTransport()),

    disconnect: async () => {
      const t = get().transport;
      unsubscribe.forEach((u) => u());
      unsubscribe = [];
      set({ transport: undefined, client: undefined, state: "disconnected", label: "" });
      await t?.close();
    },

    toggle: async () => {
      const { transport, state, lastKind, port } = get();
      if (transport && (state === "connected" || state === "connecting")) {
        await get().disconnect();
      } else if (lastKind === "mock") {
        await get().connectDemo();
      } else if (port) {
        await get().connectSerial();
      } else {
        return false;
      }
      return true;
    },

    clearTraffic: () => {
      traffic.clear();
      set((s) => ({ trafficVersion: s.trafficVersion + 1 }));
    },
  };
});
