import { csvLines, type CsvTag, type Series } from "@modfield/series";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import type { Integrity } from "./types";

const enc = new TextEncoder();

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function b64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The exact bytes that are hashed: the same CSV the logger exports. */
export function canonicalCsv(tags: CsvTag[], series: Map<string, Series>): { bytes: Uint8Array<ArrayBuffer>; rows: number } {
  const lines = [...csvLines(tags, series)];
  return { bytes: enc.encode(lines.join("\n") + "\n"), rows: lines.length - 1 };
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/** What the agent signs (report.sign): the hash only, never the data. */
export function signMessage(hash: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`modfield-report:v1:${hash}`);
}

export async function verifySignature(publicKey: string, hash: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromB64url(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(signature), signMessage(hash));
  } catch {
    return false;
  }
}

const KEYWORD_PREFIX = "modfield-integrity:";

/**
 * Post-processes the generated PDF: writes the integrity data into the
 * document metadata (so the verification page can read it back) and,
 * optionally, attaches the canonical CSV.
 */
export async function finalizePdf(pdf: Uint8Array, integrity: Integrity | undefined, csv: Uint8Array | undefined, csvName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  if (integrity) doc.setKeywords([KEYWORD_PREFIX + JSON.stringify(integrity)]);
  if (csv) {
    await doc.attach(csv, csvName, {
      mimeType: "text/csv",
      description: "ModField session data (canonical CSV, SHA-256 in the footer)",
      creationDate: new Date(),
      modificationDate: new Date(),
    });
  }
  return doc.save();
}

/** Reads the integrity data back from a PDF made by finalizePdf. */
export async function readIntegrity(pdf: Uint8Array): Promise<Integrity | undefined> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const raw = doc.getKeywords();
  const i = raw?.indexOf(KEYWORD_PREFIX) ?? -1;
  if (!raw || i < 0) return undefined;
  try {
    return JSON.parse(raw.slice(i + KEYWORD_PREFIX.length)) as Integrity;
  } catch {
    return undefined;
  }
}

/** Names of files attached to a PDF (for tests and the verification page). */
export async function attachmentNames(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const files = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const arr = files?.lookupMaybe(PDFName.of("Names"), PDFArray);
  const out: string[] = [];
  for (let i = 0; arr && i < arr.size(); i += 2) {
    const n = arr.lookup(i);
    out.push(n instanceof PDFString || n instanceof PDFHexString ? n.decodeText() : String(n));
  }
  return out;
}

export interface Verification {
  csvMatches: boolean;
  signed: boolean;
  signatureValid: boolean | undefined;
  integrity: Integrity | undefined;
  csvHash: string;
}

/** The verification page: does this CSV match this report, and did that agent sign it? */
export async function verifyReport(pdf: Uint8Array, csv: Uint8Array<ArrayBuffer>): Promise<Verification> {
  const integrity = await readIntegrity(pdf);
  const csvHash = await sha256Hex(csv);
  const sig = integrity?.signature;
  return {
    integrity,
    csvHash,
    csvMatches: integrity?.hash === csvHash,
    signed: Boolean(sig),
    signatureValid: sig ? await verifySignature(sig.publicKey, integrity!.hash, sig.value) : undefined,
  };
}

export { b64url as toB64url };
