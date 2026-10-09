"use client";
import { create } from "zustand";
import { planReads, type ReadBlock } from "@modfield/protocol";
import { ModbusClient, Poller } from "@modfield/transport";
import { db, newId, type LogSession, type TagRow } from "@/lib/db";
import { SessionWriter, decodeAgentRecord, numericTags } from "@/lib/logger";
import { useAgent } from "./agent";
import { useConnection } from "./connection";

const FLUSH_MS = 5000;

export interface StartOptions {
  profileId: string;
  name: string;
  tags: TagRow[];
  intervalMs: number;
  /** 0 = until stopped. */
  durationMs: number;
}

interface LoggerState {
  session: LogSession | undefined;
  samples: number;
  lastSampleAt: number | undefined;
  /** Bumped when stored data changes, so charts reload. */
  version: number;
  warning: string | undefined;
  error: unknown;
  start: (o: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
  addMarker: (text: string, sessionId?: string) => Promise<void>;
  /** After a reload or an agent reconnect: pick running sessions up again. */
  resume: () => Promise<void>;
  writer: () => SessionWriter | undefined;
}

let writer: SessionWriter | undefined;
let poller: Poller | undefined;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
let offAgent: (() => void) | undefined;
let syncing = false;

export const useLogger = create<LoggerState>()((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1, samples: writer?.samples ?? s.samples }));

  const persistSession = async (patch: Partial<LogSession>) => {
    const s = get().session;
    if (!s) return;
    const next = { ...s, ...patch, samples: writer?.samples ?? s.samples };
    await db.sessions.put(next);
    set({ session: next });
  };

  /** Flush to IndexedDB, then (agent mode) acknowledge what is safely stored. */
  const flush = async () => {
    if (!writer) return;
    await writer.flush();
    const s = get().session;
    await persistSession({ bytes: writer.bytes });
    if (s?.source === "agent" && s.agentLogId && s.lastSeq) {
      await useAgent.getState().client?.call("log.ack", { logId: s.agentLogId, seq: s.lastSeq }).catch(() => undefined);
    }
    bump();
  };

  const startTimers = (s: LogSession) => {
    clearInterval(flushTimer);
    flushTimer = setInterval(() => void flush(), FLUSH_MS);
    clearTimeout(stopTimer);
    if (s.stopAt && s.source === "browser") stopTimer = setTimeout(() => void get().stop(), Math.max(0, s.stopAt - Date.now()));
  };

  const ingestAgent = (plan: ReadBlock[], rec: { seq: number; t: number; results: { words?: number[]; error?: string }[] }) => {
    const s = get().session;
    if (!s || !writer || rec.seq <= s.lastSeq) return false;
    writer.ingest(decodeAgentRecord(plan, rec), rec.seq);
    s.lastSeq = rec.seq;
    set({ lastSampleAt: rec.t, samples: writer.samples });
    return true;
  };

  /** Pull everything the agent logged since lastSeq (tab closed, reload, network blip). */
  const syncAgent = async () => {
    const s = get().session;
    const client = useAgent.getState().client;
    if (!s?.agentLogId || !s.plan || !client?.authenticated || syncing) return;
    syncing = true;
    try {
      for (;;) {
        const r = await client.call<{ records: { seq: number; t: number; results: { words?: number[]; error?: string }[] }[]; lastSeq: number }>(
          "log.fetch",
          { logId: s.agentLogId, fromSeq: s.lastSeq + 1, max: 5000 },
        );
        r.records.forEach((rec) => ingestAgent(s.plan!, rec));
        if (!r.records.length || s.lastSeq >= r.lastSeq) break;
      }
      await flush();
    } finally {
      syncing = false;
    }
  };

  const attachAgent = async (s: LogSession) => {
    const client = useAgent.getState().client;
    if (!client || !s.agentLogId || !s.plan) return;
    offAgent?.();
    const plan = s.plan;
    offAgent = client.on("notification", (n) => {
      const p = n.params as { logId: string; seq: number; t: number; results: { words?: number[]; error?: string }[]; freeBytes?: number };
      if (p.logId !== get().session?.agentLogId) return;
      if (n.method === "log.cycle") {
        // A hole in the sequence means notifications were lost: fetch instead.
        if (p.seq !== (get().session?.lastSeq ?? 0) + 1) void syncAgent();
        else ingestAgent(plan, p);
      } else if (n.method === "log.stopped") {
        void finish("stopped");
      } else if (n.method === "log.warning") {
        set({ warning: "lowDisk" });
      }
    });
    await client.call("log.subscribe", { logId: s.agentLogId });
    await syncAgent();
  };

  const finish = async (status: LogSession["status"]) => {
    poller?.stop();
    poller = undefined;
    offAgent?.();
    offAgent = undefined;
    clearInterval(flushTimer);
    clearTimeout(stopTimer);
    if (get().session?.source === "agent") await syncAgent();
    await flush();
    await persistSession({ status, endedAt: get().lastSampleAt ?? Date.now() });
    writer = undefined;
    set({ session: undefined });
    bump();
  };

  return {
    session: undefined,
    samples: 0,
    lastSampleAt: undefined,
    version: 0,
    warning: undefined,
    error: undefined,
    writer: () => writer,

    start: async (o) => {
      if (get().session) return;
      const tags = numericTags(o.tags) as TagRow[];
      const conn = useConnection.getState();
      const viaAgent = conn.transport?.kind === "agent" && conn.last?.agent && useAgent.getState().client?.authenticated;
      if (!conn.client || !tags.length) return;
      const now = Date.now();
      const s: LogSession = {
        id: newId(),
        profileId: o.profileId,
        name: o.name,
        startedAt: now,
        stopAt: o.durationMs ? now + o.durationMs : undefined,
        intervalMs: o.intervalMs,
        source: viaAgent ? "agent" : "browser",
        status: "running",
        tags,
        lastSeq: 0,
        samples: 0,
        bytes: 0,
      };
      set({ error: undefined, warning: undefined, samples: 0, lastSampleAt: undefined });
      try {
        if (viaAgent) {
          // Gapless blocks: the agent cannot re-split a running plan when a
          // device refuses reads across unmapped holes.
          s.plan = planReads(tags, { maxGap: 0 });
          const r = await useAgent.getState().client!.call<{ logId: string }>("log.start", {
            name: o.name,
            conn: conn.last!.agent,
            blocks: s.plan.map(({ unitId, table, offset, quantity }) => ({ unitId, table, offset, quantity })),
            intervalMs: o.intervalMs,
            timeoutMs: conn.timeoutMs,
            durationMs: o.durationMs || undefined,
          });
          s.agentLogId = r.logId;
        }
        await db.sessions.add(s);
        writer = new SessionWriter(s.id, new Set(tags.map((t) => t.id)));
        set({ session: s });
        startTimers(s);
        if (viaAgent) {
          await attachAgent(s);
        } else {
          poller = new Poller(new ModbusClient(conn.transport!, { timeoutMs: conn.timeoutMs }), tags, o.intervalMs);
          poller.on("cycle", (c) => {
            writer?.ingest(c.samples);
            set({ lastSampleAt: c.t, samples: writer?.samples ?? 0 });
          });
          poller.start();
        }
      } catch (e) {
        set({ error: e });
      }
    },

    stop: async () => {
      const s = get().session;
      if (!s) return;
      if (s.source === "agent" && s.agentLogId) await useAgent.getState().client?.call("log.stop", { logId: s.agentLogId }).catch(() => undefined);
      await finish("stopped");
    },

    addMarker: async (text, sessionId) => {
      const id = sessionId ?? get().session?.id;
      if (!id || !text.trim()) return;
      await db.markers.add({ sessionId: id, t: Date.now(), text: text.trim() });
      bump();
    },

    resume: async () => {
      if (get().session) {
        if (get().session!.source === "agent") await attachAgent(get().session!);
        return;
      }
      const running = await db.sessions.where("status").equals("running").toArray();
      for (const s of running) {
        if (s.source === "browser") {
          // The browser poller died with the page: what was flushed stays, the rest is a gap.
          await db.sessions.put({ ...s, status: "interrupted", endedAt: s.endedAt ?? Date.now() });
          continue;
        }
        const client = useAgent.getState().client;
        if (!client?.authenticated || !s.agentLogId) continue;
        const list = await client.call<{ logs: { logId: string; running: boolean }[] }>("log.list").catch(() => ({ logs: [] }));
        const meta = list.logs.find((l) => l.logId === s.agentLogId);
        writer = new SessionWriter(s.id, new Set(s.tags.map((t) => t.id)));
        writer.samples = s.samples;
        set({ session: s, samples: s.samples });
        if (meta?.running) {
          startTimers(s);
          await attachAgent(s);
        } else {
          // Finished while we were away: collect the rest and close it.
          await syncAgent();
          await finish(meta ? "stopped" : "interrupted");
        }
        break;
      }
      bump();
    },
  };
});

// When the agent (re)authenticates, running agent sessions sync and subscribe again.
useAgent.subscribe((s, prev) => {
  if (s.status === "paired" && prev.status !== "paired") void useLogger.getState().resume();
});
