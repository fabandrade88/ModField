"use client";
import { toSeries, type SampleBlock, type Series } from "@modfield/series";
import { useCallback, useEffect, useRef, useState } from "react";
import { db, type LogSession } from "@/lib/db";
import { useLogger } from "@/store/logger";

/**
 * Series of the given tags of a session: stored blocks plus, while the
 * session runs, the blocks still being filled in memory.
 *
 * The stored blocks only change on a flush (store `version`), so they are read
 * from IndexedDB only then and cached. The 1 s tick that refreshes the live
 * tail rebuilds from the cache plus the in-memory current block — it never
 * touches IndexedDB nor re-reads the whole history, so the per-second cost does
 * not grow with how long the session has been running.
 */
export function useSessionSeries(session: LogSession | undefined, tagIds: string[]): Map<string, Series> {
  const version = useLogger((s) => s.version);
  const running = useLogger((s) => s.session?.id === session?.id && Boolean(s.session));
  const [tick, setTick] = useState(0);
  const [out, setOut] = useState<Map<string, Series>>(new Map());
  const stored = useRef<Map<string, SampleBlock[]>>(new Map());
  const key = tagIds.join("|");

  // Rebuild the combined series from the cached stored blocks and the in-memory
  // current block. Cheap: no IndexedDB, no full-history re-query.
  const rebuild = useCallback(() => {
    if (!session) return setOut(new Map());
    const writer = useLogger.getState().writer();
    const m = new Map<string, Series>();
    for (const tagId of tagIds) {
      const blocks = stored.current.get(tagId) ?? [];
      const cur = running && writer?.sessionId === session.id ? writer.current(tagId) : undefined;
      // The block being filled may already be stored partially: prefer the live copy.
      const base = cur ? blocks.filter((b) => b.t0 !== cur.t0) : blocks;
      m.set(tagId, toSeries(cur ? [...base, cur] : base));
    }
    setOut(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, key, running]);

  // Read (and cache) the stored blocks only when they can have changed: the
  // session, the tag set, or a flush (version). This is the only IndexedDB path.
  useEffect(() => {
    if (!session) {
      stored.current = new Map();
      setOut(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const m = new Map<string, SampleBlock[]>();
      for (const tagId of tagIds) {
        m.set(tagId, await db.blocks.where("[sessionId+tagId]").equals([session.id, tagId]).toArray());
      }
      if (cancelled) return;
      stored.current = m;
      rebuild();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, key, version]);

  // Live tail: while running, refresh from the cache + current block every second.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    rebuild();
  }, [tick, rebuild]);

  return out;
}
