"use client";

export type OsId = "windows" | "darwin" | "linux";
export type ArchId = "amd64" | "arm64";

/** Best guess of the visitor's system, for the recommended agent download. */
export function detectPlatform(): { os: OsId | undefined; arch: ArchId } {
  if (typeof navigator === "undefined") return { os: undefined, arch: "amd64" };
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const p = `${uaData?.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  const os: OsId | undefined = p.includes("win") ? "windows" : p.includes("mac") ? "darwin" : p.includes("linux") || p.includes("x11") ? "linux" : undefined;
  const arch: ArchId = /arm64|aarch64/.test(p) ? "arm64" : "amd64";
  return { os, arch };
}

export interface DownloadFile {
  name: string;
  os: OsId;
  arch: ArchId;
  kind: "binary" | "portable" | "installer";
  bytes: number;
  sha256: string;
}

export interface DownloadManifest {
  version: string;
  files: DownloadFile[];
}

/** /downloads/manifest.json, written by scripts/dist-agent.sh; undefined when not published here. */
export async function loadDownloads(): Promise<DownloadManifest | undefined> {
  try {
    const res = await fetch("/downloads/manifest.json", { cache: "no-store" });
    if (!res.ok) return undefined;
    return (await res.json()) as DownloadManifest;
  } catch {
    return undefined;
  }
}

export function mb(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(0)} MB`;
}
