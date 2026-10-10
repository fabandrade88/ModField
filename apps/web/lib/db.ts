"use client";
import Dexie, { type EntityTable } from "dexie";
import type { ReadBlock, TagDef } from "@modfield/protocol";
import type { SampleBlock } from "@modfield/series";
import type { AcceptanceTest, Company, ReportLang, SectionId, SignatureBlock } from "@modfield/report";
import type { SerialSettings, SimSlaveConfig } from "@modfield/transport";

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

export type SessionSource = "browser" | "agent";
export type SessionStatus = "running" | "stopped" | "interrupted";

/** One data logger session. Tags are a snapshot: editing a tag later does not change old data. */
export interface LogSession {
  id: string;
  profileId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  stopAt?: number;
  intervalMs: number;
  source: SessionSource;
  status: SessionStatus;
  tags: TagRow[];
  /** Agent mode: its log id, the connection and the read plan the agent runs. */
  agentLogId?: string;
  plan?: ReadBlock[];
  /** Last agent sequence stored here (and acknowledged). */
  lastSeq: number;
  samples: number;
  bytes: number;
}

export interface StoredBlock extends SampleBlock {
  id?: number;
  sessionId: string;
}

export interface Marker {
  id?: number;
  sessionId: string;
  t: number;
  text: string;
}

export interface CompanyRow extends Company {
  id: "company";
}

/** Per-client template: sections on or off and a default list of tests. */
export interface ReportTemplate {
  id: string;
  name: string;
  lang: ReportLang;
  sections: Record<SectionId, boolean>;
  /** Tests by tag name, so a template works across profiles with the same map. */
  tests: { tagName: string; expected: number; tolerance: AcceptanceTest["tolerance"] }[];
  signatures: SignatureBlock["role"][];
}

/** A report being prepared; saved as you type. */
export interface ReportDraft {
  id: string;
  profileId: string;
  number: string;
  date: number;
  lang: ReportLang;
  templateId?: string;
  sessionId?: string;
  identification: { client: string; plant: string; area: string; project: string; responsible: string };
  sections: Record<SectionId, boolean>;
  tests: AcceptanceTest[];
  observations: string;
  pending: string;
  signatures: SignatureBlock[];
  attachCsv: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A saved simulator setup (runs on the agent). */
export interface SimSetup {
  id: string;
  name: string;
  transport: "tcp" | "rtu";
  listen: string;
  allowLan: boolean;
  port?: string;
  baudRate: number;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
  slaves: SimSlaveConfig[];
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
  sessions: EntityTable<LogSession, "id">;
  blocks: EntityTable<StoredBlock, "id">;
  markers: EntityTable<Marker, "id">;
  company: EntityTable<CompanyRow, "id">;
  templates: EntityTable<ReportTemplate, "id">;
  reports: EntityTable<ReportDraft, "id">;
  sims: EntityTable<SimSetup, "id">;
};

db.version(1).stores({
  profiles: "id, name",
  tags: "id, profileId, sort",
  equipment: "id, profileId",
  writes: "++id, t, profileId",
  scans: "++id, t, profileId",
});
db.version(2).stores({ agent: "id" });
db.version(3).stores({
  sessions: "id, profileId, startedAt, status",
  blocks: "++id, sessionId, [sessionId+tagId]",
  markers: "++id, sessionId, t",
});
db.version(4).stores({ company: "id", templates: "id, name", reports: "id, profileId, createdAt" });
db.version(5).stores({ sims: "id, name" });

export const newId = () => crypto.randomUUID();
