"use client";
import { BlockBuilder, Q_BAD, Q_GOOD, emptyBlock, trimmed } from "@modfield/series";
import type { AcceptanceTest, ReportLang } from "@modfield/report";
import { db, type CompanyRow, type LogSession, type ReportDraft, type StoredBlock, type TagRow } from "./db";
import { ALL_SECTIONS } from "./report";

/** Fixed ids so loading the example twice reuses it instead of piling up copies. */
export const DEMO_SESSION_ID = "demo-session";
export const DEMO_REPORT_ID = "demo-report";

const HOUR = 3_600_000;

/** Analog measurements (not bits, not strings): the ones worth plotting and testing. */
function analogTags(tags: TagRow[]): TagRow[] {
  const analog = tags.filter((t) => (t.table === "holding" || t.table === "input") && t.type !== "STRING");
  // Prefer the ones with an engineering unit, so the demo curves and labels read well.
  const withUnit = analog.filter((t) => t.unit);
  return withUnit.length >= 3 ? withUnit : analog;
}

/** A believable engineering-unit curve for a tag at a given elapsed time. */
function demoValue(tag: TagRow, i: number, elapsedMs: number): number {
  const u = (tag.unit ?? "").toLowerCase();
  const wobble = Math.sin(elapsedMs / 2111) * Math.cos(elapsedMs / 877);
  const sine = (base: number, amp: number, period: number) => base + amp * Math.sin((2 * Math.PI * elapsedMs) / period) + amp * 0.07 * wobble;
  const ramp = (min: number, max: number, period: number) => min + (max - min) * ((elapsedMs % period) / period);
  if (u.includes("hz")) return sine(50, 5, 120_000);
  if (u.includes("°c")) return sine(41, 1.6, 600_000);
  if (u === "ma") return ramp(4, 20, 300_000);
  if (u === "a") return sine(11.2, 0.8, 40_000);
  if (u.includes("bar")) return sine(6.2, 0.35, 90_000);
  if (u.includes("m³/h") || u.includes("m3/h")) return sine(12.5, 0.5, 20_000);
  if (u.includes("m³") || u.includes("m3")) return ramp(0, 8, HOUR); // totalizer, slowly rising
  const presets: [number, number, number][] = [
    [45, 4, 120_000],
    [11.2, 0.8, 40_000],
    [41, 1.6, 600_000],
    [6.2, 0.35, 90_000],
  ];
  const [base, amp, period] = presets[i % presets.length]!;
  return sine(base, amp, period);
}

const round = (v: number, decimals = 2) => {
  const p = 10 ** (decimals ?? 2);
  return Math.round(v * p) / p;
};

const SESSION_NAME: Record<ReportLang, string> = {
  pt: "Ensaio de comissionamento (exemplo)",
  en: "Commissioning run (example)",
  de: "Inbetriebnahme (Beispiel)",
};
const MARKERS: Record<ReportLang, [number, string][]> = {
  pt: [[10, "Partida do motor"], [35, "Ajuste de setpoint"]],
  en: [[10, "Motor started"], [35, "Setpoint adjusted"]],
  de: [[10, "Motor gestartet"], [35, "Sollwert angepasst"]],
};

/** A finished 1-hour log of the demo bench, so the Logger and the report trends have data. */
export async function ensureDemoSession(profileId: string, lang: ReportLang): Promise<string | undefined> {
  if (await db.sessions.get(DEMO_SESSION_ID)) return DEMO_SESSION_ID;
  const pens = analogTags(await db.tags.where("profileId").equals(profileId).sortBy("sort")).slice(0, 4);
  if (pens.length === 0) return undefined;

  const intervalMs = 5000;
  const count = HOUR / intervalMs + 1;
  const endedAt = Date.now();
  const startedAt = endedAt - HOUR;
  const blocks: StoredBlock[] = [];
  let samples = 0;
  pens.forEach((tag, i) => {
    const block = emptyBlock(tag.id, startedAt);
    const b = new BlockBuilder(block);
    for (let k = 0; k < count; k++) {
      // A short injected gap on the first pen, so the trend and the stats show one.
      const bad = i === 0 && k >= 300 && k < 306;
      b.push(startedAt + k * intervalMs, demoValue(tag, i, k * intervalMs), bad ? Q_BAD : Q_GOOD);
    }
    blocks.push({ ...trimmed(block), sessionId: DEMO_SESSION_ID });
    samples += block.n;
  });

  const session: LogSession = {
    id: DEMO_SESSION_ID,
    profileId,
    name: SESSION_NAME[lang],
    startedAt,
    endedAt,
    intervalMs,
    source: "browser",
    status: "stopped",
    tags: pens,
    lastSeq: 0,
    samples,
    bytes: samples * 13,
  };
  const markers = MARKERS[lang].map(([min, text]) => ({ sessionId: DEMO_SESSION_ID, t: startedAt + min * 60_000, text }));
  await db.transaction("rw", db.sessions, db.blocks, db.markers, async () => {
    await db.sessions.put(session);
    await db.blocks.where("sessionId").equals(DEMO_SESSION_ID).delete();
    await db.blocks.bulkAdd(blocks);
    await db.markers.where("sessionId").equals(DEMO_SESSION_ID).delete();
    await db.markers.bulkAdd(markers);
  });
  return DEMO_SESSION_ID;
}

const COMPANY: Record<ReportLang, Omit<CompanyRow, "id">> = {
  pt: { name: "Integradora Exemplo Ltda.", taxId: "12.345.678/0001-90", address: "Rua das Indústrias, 100 — São Paulo/SP", phone: "+55 11 4000-0000", email: "contato@exemplo.com.br", website: "exemplo.com.br" },
  en: { name: "Example Integration Co.", taxId: "12-3456789", address: "100 Industrial Ave — Springfield", phone: "+1 555 000 0000", email: "contact@example.com", website: "example.com" },
  de: { name: "Beispiel Integration GmbH", taxId: "DE123456789", address: "Industriestraße 100 — Musterstadt", phone: "+49 30 000000", email: "kontakt@beispiel.de", website: "beispiel.de" },
};
const IDENTIFICATION: Record<ReportLang, ReportDraft["identification"]> = {
  pt: { client: "Estação de Tratamento Norte", plant: "ETA Norte", area: "Casa de bombas 2", project: "Automação do recalque", responsible: "Eng. A. Pereira" },
  en: { client: "North Treatment Plant", plant: "North WTP", area: "Pump house 2", project: "Booster automation", responsible: "A. Pereira, P.E." },
  de: { client: "Wasserwerk Nord", plant: "WW Nord", area: "Pumpenhaus 2", project: "Automatisierung Druckerhöhung", responsible: "Dipl.-Ing. A. Pereira" },
};
const OBSERVATIONS: Record<ReportLang, { observations: string; pending: string }> = {
  pt: { observations: "Comunicação estável durante o ensaio; sem timeouts após o ajuste do delay entre requisições. Vazão dentro da faixa esperada.", pending: "Reapertar o borne do transmissor de pressão PT-101 na próxima parada." },
  en: { observations: "Communication stable throughout the run; no timeouts after tuning the inter-request delay. Flow within the expected range.", pending: "Re-tighten the PT-101 pressure transmitter terminal at the next shutdown." },
  de: { observations: "Kommunikation während des Versuchs stabil; keine Timeouts nach Anpassung der Verzögerung. Durchfluss im erwarteten Bereich.", pending: "Klemme des Drucktransmitters PT-101 bei der nächsten Abschaltung nachziehen." },
};
const SIGN: Record<ReportLang, { exec: [string, string]; client: [string, string] }> = {
  pt: { exec: ["A. Pereira", "Engenheiro de comissionamento"], client: ["M. Souza", "Supervisor de manutenção"] },
  en: { exec: ["A. Pereira", "Commissioning engineer"], client: ["M. Souza", "Maintenance supervisor"] },
  de: { exec: ["A. Pereira", "Inbetriebnahme-Ingenieur"], client: ["M. Souza", "Instandhaltungsleiter"] },
};

/** A fully-filled example report for the demo profile: identification, acceptance tests (one failing), a logged session and signatures. */
export async function ensureDemoReport(profileId: string, lang: ReportLang): Promise<string> {
  const sessionId = await ensureDemoSession(profileId, lang);
  if (!(await db.company.get("company"))) await db.company.put({ id: "company", ...COMPANY[lang] });
  if (await db.reports.get(DEMO_REPORT_ID)) return DEMO_REPORT_ID;

  const analog = analogTags(await db.tags.where("profileId").equals(profileId).sortBy("sort"));
  const now = Date.now();
  const dateStr = (ms: number) => new Date(ms).toLocaleDateString(lang === "pt" ? "pt-BR" : lang === "de" ? "de-DE" : "en-GB");
  const tests: AcceptanceTest[] = analog.slice(0, 3).map((tag, i) => {
    const expected = round(demoValue(tag, i, 0), tag.decimals);
    const fail = i === 1; // one failing test, to show a red verdict
    const measured = round(expected * (fail ? 1.12 : 1.01), tag.decimals);
    return { id: `${DEMO_REPORT_ID}-t${i}`, tagId: tag.id, expected, tolerance: { kind: "pct", value: 5 }, measured: { value: measured, how: "capture", at: now } };
  });
  const s = SIGN[lang];
  const draft: ReportDraft = {
    id: DEMO_REPORT_ID,
    profileId,
    number: `MF-${new Date().getFullYear()}-EX`,
    date: now,
    lang,
    sessionId,
    identification: IDENTIFICATION[lang],
    sections: { ...ALL_SECTIONS },
    tests,
    observations: OBSERVATIONS[lang].observations,
    pending: OBSERVATIONS[lang].pending,
    signatures: [
      { role: "executor", enabled: true, name: s.exec[0], function: s.exec[1], company: COMPANY[lang].name, date: dateStr(now) },
      { role: "client", enabled: true, name: s.client[0], function: s.client[1], company: IDENTIFICATION[lang].client, date: dateStr(now) },
      { role: "third", enabled: false, name: "", function: "", company: "", date: "" },
    ],
    attachCsv: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.reports.put(draft);
  return DEMO_REPORT_ID;
}
