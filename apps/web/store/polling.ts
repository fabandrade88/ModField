"use client";
import { create } from "zustand";
import { Poller, type Cycle, type Sample } from "@modfield/transport";
import type { TagDef } from "@modfield/protocol";
import { useConnection } from "./connection";

interface PollingState {
  running: boolean;
  intervalMs: number;
  /** Latest sample per tag id. */
  latest: Record<string, Sample>;
  cycleMs: number | undefined;
  requestsPerCycle: number | undefined;
  lastCycleAt: number | undefined;

  setIntervalMs: (ms: number) => void;
  readNow: (tags: TagDef[]) => Promise<void>;
  start: (tags: TagDef[]) => void;
  stop: () => void;
  /** Called by the logger (phase 4) and anyone else who wants every cycle. */
  subscribe: (cb: (c: Cycle) => void) => () => void;
}

let poller: Poller | undefined;
const listeners = new Set<(c: Cycle) => void>();

/** Cyclic read of the active profile's tags, shared by the Read module and the status bar. */
export const usePolling = create<PollingState>()((set, get) => {
  const apply = (c: Cycle) => {
    set((s) => {
      const latest = { ...s.latest };
      for (const sample of c.samples) {
        // Keep the last good value on failure, flagged bad: the UI shows it as stale with "?".
        const prev = latest[sample.tagId];
        latest[sample.tagId] = sample.quality === "good" ? sample : { ...sample, value: prev?.value, raw: prev?.raw };
      }
      return { latest, cycleMs: c.cycleMs, requestsPerCycle: c.requests, lastCycleAt: c.t };
    });
    listeners.forEach((l) => l(c));
  };

  return {
    running: false,
    intervalMs: 1000,
    latest: {},
    cycleMs: undefined,
    requestsPerCycle: undefined,
    lastCycleAt: undefined,

    setIntervalMs: (intervalMs) => {
      if (poller) poller.intervalMs = intervalMs;
      set({ intervalMs });
    },

    readNow: async (tags) => {
      const client = useConnection.getState().client;
      if (!client || !tags.length) return;
      apply(await new Poller(client, tags, get().intervalMs).once());
    },

    start: (tags) => {
      const client = useConnection.getState().client;
      if (!client || !tags.length) return;
      poller?.stop();
      poller = new Poller(client, tags, get().intervalMs);
      poller.on("cycle", apply);
      poller.start();
      set({ running: true });
    },

    stop: () => {
      poller?.stop();
      poller = undefined;
      set({ running: false });
    },

    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
});

// A lost connection stops the poller.
useConnection.subscribe((s, prev) => {
  if (prev.client && !s.client) usePolling.getState().stop();
});
