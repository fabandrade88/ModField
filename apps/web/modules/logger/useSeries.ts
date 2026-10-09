"use client";
import { toSeries, type SampleBlock, type Series } from "@modfield/series";
import { useEffect, useState } from "react";
import { db, type LogSession } from "@/lib/db";
import { useLogger } from "@/store/logger";

/**
 * Series of the given tags of a session: stored blocks plus, while the
 * session runs, the blocks still being filled in memory.
 */
export function useSessionSeries(session: LogSession | undefined, tagIds: string[]): Map<string, Series> {
  const version = useLogger((s) => s.version);
  const running = useLogger((s) => s.session?.id === session?.id && Boolean(s.session));
  const [tick, setTick] = useState(0);
  const [out, setOut] = useState<Map<string, Series>>(new Map());
  const key = tagIds.join("|");

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!session) return setOut(new Map());
    let cancelled = false;
    void (async () => {
      const writer = useLogger.getState().writer();
      const m = new Map<string, Series>();
      for (const tagId of tagIds) {
        const stored = await db.blocks.where("[sessionId+tagId]").equals([session.id, tagId]).toArray();
        const live: SampleBlock[] = [];
        const cur = running && writer?.sessionId === session.id ? writer.current(tagId) : undefined;
        // The block being filled may already be stored partially: prefer the live copy.
        const blocks = cur ? stored.filter((b) => b.t0 !== cur.t0) : stored;
        if (cur) live.push(cur);
        m.set(tagId, toSeries([...blocks, ...live]));
      }
      if (!cancelled) setOut(m);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, key, version, tick, running]);

  return out;
}
