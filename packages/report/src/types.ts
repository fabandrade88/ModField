export type ReportLang = "pt" | "en" | "de";

export type SectionId =
  | "identification"
  | "equipment"
  | "communication"
  | "tests"
  | "writes"
  | "scans"
  | "trends"
  | "observations"
  | "signatures";

export const SECTIONS: SectionId[] = ["identification", "equipment", "communication", "tests", "writes", "scans", "trends", "observations", "signatures"];

export interface Tolerance {
  kind: "abs" | "pct";
  value: number;
}

export type MeasureHow = "capture" | "mean" | "min" | "max";

export interface AcceptanceTest {
  id: string;
  tagId: string;
  expected: number;
  tolerance: Tolerance;
  measured?: { value: number; how: MeasureHow; at: number; from?: number; to?: number };
  /** A manual verdict needs a justification, printed in the report. */
  override?: { result: "pass" | "fail"; justification: string };
}

export type Verdict = "pass" | "fail" | "pending";

export interface SignatureBlock {
  role: "executor" | "client" | "third";
  enabled: boolean;
  name: string;
  function: string;
  company: string;
  date: string;
  /** Drawn on screen: a picture, not a qualified digital signature. */
  image?: string;
}

export interface Company {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** PNG data URL (SVG uploads are rasterized). */
  logo?: string;
}

export interface Integrity {
  /** SHA-256 of the canonical session CSV, hex. */
  hash: string;
  rows: number;
  signature?: { value: string; publicKey: string; fingerprint: string };
}

/** Everything the PDF prints, already resolved and formatted where it matters. */
export interface ReportData {
  lang: ReportLang;
  number: string;
  date: string;
  appVersion: string;
  company: Company;
  sections: Record<SectionId, boolean>;
  identification: { client: string; plant: string; area: string; project: string; responsible: string };
  equipment: { manufacturer: string; model: string; serialNumber: string; tag: string; unitId: number; firmware: string }[];
  communication: { label: string; value: string }[];
  tests: {
    tag: string;
    unit: string;
    expected: string;
    measured: string;
    how: string;
    tolerance: string;
    verdict: Verdict;
    justification?: string;
  }[];
  writes: { time: string; tag: string; address: string; previous: string; next: string; result: string }[];
  scans: { time: string; kind: string; params: string; result: string }[];
  trends: {
    session: string;
    period: string;
    image?: string;
    stats: { tag: string; unit: string; min: string; max: string; mean: string; std: string; n: number; gaps: number }[];
    markers: { time: string; text: string }[];
  }[];
  observations: string;
  pending: string;
  signatures: SignatureBlock[];
  integrity?: Integrity;
  csvAttached: boolean;
}
