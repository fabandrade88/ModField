"use client";
import Dexie, { type EntityTable } from "dexie";
import type { TagDef } from "@modfield/protocol";
import type { SerialSettings } from "@modfield/transport";

export interface Profile {
  id: string;
  name: string;
  serial: SerialSettings;
  /** RTU through the browser (Web Serial) or through the agent. */
  rtuVia?: "browser" | "agent";
  /** Port name on the agent's machine: COM3, /dev/ttyUSB0. */
  agentPort?: string;
  tcp: { host: string; port: number };
  timeoutMs: number;
  /** Some devices only accept function 16, even for one register. */
  forceMultipleWrite: boolean;
  updatedAt: number;
}

export interface TagRow extends TagDef {
  profileId: string;
  sort: number;
}

export interface Equipment {
  id: string;
  profileId: string;
  unitId: number;
  manufacturer: string;
  model: string;
  serialNumber: string;
  tag: string;
  firmware: string;
}

export type WriteResult = "ok" | "exception" | "unknown" | "error";

export interface WriteRecord {
  id?: number;
  t: number;
  profileId: string;
  unitId: number;
  table: "holding" | "coil";
  offset: number;
  type: string;
  fc: number;
  tagId?: string;
  tagName?: string;
  previous: string | undefined;
  next: string;
  result: WriteResult;
  detail?: string;
}

/** Pairing with the local agent. The secret never leaves this browser. */
export interface AgentPairing {
  id: "pairing";
  tokenId: string;
  secret: string;
  publicKey: string;
  fingerprint: string;
  pairedAt: number;
}

export type ScanKind = "ids" | "serial" | "passive" | "registers" | "ip";

export interface ScanRecord {
  id?: number;
  t: number;
  profileId: string;
  kind: ScanKind;
  params: string;
  result: string;
}

/**
 * Everything stays in this browser's IndexedDB; nothing goes to a server.
 * Backups are the project file export (phase 4).
 */
export const db = new Dexie("modfield") as Dexie & {
  profiles: EntityTable<Profile, "id">;
  tags: EntityTable<TagRow, "id">;
  equipment: EntityTable<Equipment, "id">;
  writes: EntityTable<WriteRecord, "id">;
  scans: EntityTable<ScanRecord, "id">;
  agent: EntityTable<AgentPairing, "id">;
};

db.version(1).stores({
  profiles: "id, name",
  tags: "id, profileId, sort",
  equipment: "id, profileId",
  writes: "++id, t, profileId",
  scans: "++id, t, profileId",
});
db.version(2).stores({ agent: "id" });

export const newId = () => crypto.randomUUID();
