"use client";
import { db, type LogSession, type Marker, type StoredBlock } from "./db";
import { toB64url, fromB64url } from "@modfield/transport";

/**
 * Project file (.modfield): gzip of a JSON document with everything in this
 * browser except the agent pairing (it belongs to this browser only).
 */
export const PROJECT_FORMAT = "modfield-project";
export const PROJECT_VERSION = 1;

type EncodedBlock = Omit<StoredBlock, "dt" | "v" | "q" | "id"> & { dt: string; v: string; q: string };

interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  profiles: unknown[];
  tags: unknown[];
  equipment: unknown[];
  writes: unknown[];
  scans: unknown[];
  extra: Record<string, unknown[]>;
  sessions?: LogSession[];
  blocks?: EncodedBlock[];
  markers?: Marker[];
}

const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Tables added by later phases join the file without changing this code. */
export const EXTRA_TABLES: string[] = ["company", "templates", "reports", "sims"];

export async function exportProject(includeSessions: boolean): Promise<Blob> {
  const doc: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "ModField",
    profiles: await db.profiles.toArray(),
    tags: await db.tags.toArray(),
    equipment: await db.equipment.toArray(),
    writes: await db.writes.toArray(),
    scans: await db.scans.toArray(),
    extra: {},
  };
  for (const name of EXTRA_TABLES) doc.extra[name] = await db.table(name).toArray();
  if (includeSessions) {
    doc.sessions = (await db.sessions.toArray()).map((s) => (s.status === "running" ? { ...s, status: "interrupted" as const } : s));
    doc.markers = await db.markers.toArray();
    doc.blocks = [];
    await db.blocks.each(({ id: _id, dt, v, q, ...rest }) => {
      doc.blocks!.push({ ...rest, dt: toB64url(bytesOf(dt)), v: toB64url(bytesOf(v)), q: toB64url(q) });
    });
  }
  const json = new Blob([JSON.stringify(doc)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(json).blob();
}

export interface ImportSummary {
  profiles: number;
  tags: number;
  sessions: number;
}

export class ProjectFormatError extends Error {}

/** Merges a project file: records with the same id are replaced. */
export async function importProject(file: Blob): Promise<ImportSummary> {
  let doc: ProjectFile;
  try {
    const text = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
    doc = JSON.parse(text) as ProjectFile;
  } catch {
    throw new ProjectFormatError("not a .modfield file");
  }
  if (doc.format !== PROJECT_FORMAT || typeof doc.version !== "number") throw new ProjectFormatError("not a .modfield file");
  if (doc.version > PROJECT_VERSION) throw new ProjectFormatError(`made by a newer version (${doc.version})`);

  await db.transaction("rw", [db.profiles, db.tags, db.equipment, db.writes, db.scans, db.sessions, db.blocks, db.markers, ...EXTRA_TABLES.map((n) => db.table(n))], async () => {
    await db.profiles.bulkPut(doc.profiles as never[]);
    await db.tags.bulkPut(doc.tags as never[]);
    await db.equipment.bulkPut(doc.equipment as never[]);
    await db.writes.bulkPut((doc.writes as { id?: number }[]).map(({ id: _id, ...w }) => w) as never[]);
    await db.scans.bulkPut((doc.scans as { id?: number }[]).map(({ id: _id, ...s }) => s) as never[]);
    for (const name of EXTRA_TABLES) if (doc.extra?.[name]) await db.table(name).bulkPut(doc.extra[name]!);
    if (doc.sessions) {
      const ids = new Set(doc.sessions.map((s) => s.id));
      // Re-importing the same session replaces its samples instead of doubling them.
      await db.blocks.where("sessionId").anyOf([...ids]).delete();
      await db.markers.where("sessionId").anyOf([...ids]).delete();
      await db.sessions.bulkPut(doc.sessions);
      await db.markers.bulkPut((doc.markers ?? []).map(({ id: _id, ...m }) => m) as never[]);
      await db.blocks.bulkAdd(
        (doc.blocks ?? []).map((b) => ({
          ...b,
          dt: new Uint32Array(fromB64url(b.dt).buffer),
          v: new Float64Array(fromB64url(b.v).buffer),
          q: fromB64url(b.q),
        })),
      );
    }
  });
  return { profiles: doc.profiles.length, tags: doc.tags.length, sessions: doc.sessions?.length ?? 0 };
}
