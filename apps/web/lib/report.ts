"use client";
import { formatClassic, formatTagValue } from "@modfield/protocol";
import { REPORT_STRINGS, canonicalCsv, evaluate, finalizePdf, sha256Hex, type Integrity, type ReportData, type ReportLang, type SectionId } from "@modfield/report";
import { toSeries, windowStats, type Series } from "@modfield/series";
import { useAgent } from "@/store/agent";
import { db, newId, type ReportDraft, type TagRow } from "./db";

export const APP_VERSION = "0.5.0";

export const ALL_SECTIONS: Record<SectionId, boolean> = {
  identification: true,
  equipment: true,
  communication: true,
  tests: true,
  writes: true,
  scans: true,
  trends: true,
  observations: true,
  signatures: true,
};

const LOCALE: Record<ReportLang, string> = { pt: "pt-BR", en: "en-GB", de: "de-DE" };

/** MF-2026-007: per year, counting the reports made this year. */
export async function nextNumber(now = new Date()): Promise<string> {
  const y = now.getFullYear();
  const start = new Date(y, 0, 1).getTime();
  const n = (await db.reports.where("createdAt").aboveOrEqual(start).count()) + 1;
  return `MF-${y}-${String(n).padStart(3, "0")}`;
}

export async function newDraft(profileId: string, lang: ReportLang): Promise<ReportDraft> {
  const now = Date.now();
  const lastSession = await db.sessions.where("profileId").equals(profileId).reverse().sortBy("startedAt");
  const draft: ReportDraft = {
    id: newId(),
    profileId,
    number: await nextNumber(),
    date: now,
    lang,
    sessionId: lastSession.find((s) => s.status !== "running")?.id,
    identification: { client: "", plant: "", area: "", project: "", responsible: "" },
    sections: { ...ALL_SECTIONS },
    tests: [],
    observations: "",
    pending: "",
    signatures: [
      { role: "executor", enabled: true, name: "", function: "", company: "", date: "" },
      { role: "client", enabled: true, name: "", function: "", company: "", date: "" },
      { role: "third", enabled: false, name: "", function: "", company: "", date: "" },
    ],
    attachCsv: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.reports.add(draft);
  return draft;
}

export async function sessionSeries(sessionId: string, tags: TagRow[]): Promise<Map<string, Series>> {
  const out = new Map<string, Series>();
  for (const t of tags) out.set(t.id, toSeries(await db.blocks.where("[sessionId+tagId]").equals([sessionId, t.id]).toArray()));
  return out;
}

const fmt = (tag: Pick<TagRow, "decimals">, v: number) => (Number.isFinite(v) ? formatTagValue({ decimals: tag.decimals }, v) : "—");

/**
 * Everything the PDF prints. Trend images come from `image` (screen code,
 * needs a DOM); integrity is computed here from the session's canonical CSV.
 */
export async function buildReport(
  draft: ReportDraft,
  image: (pens: { label: string; unit?: string; axis: "left" | "right"; series: Series }[], markers: { t: number; text: string }[], gapMs: number) => Promise<string | undefined>,
): Promise<{ data: ReportData; csv?: Uint8Array<ArrayBuffer>; csvName: string }> {
  const t = REPORT_STRINGS[draft.lang];
  const locale = LOCALE[draft.lang];
  const time = (ms: number) => new Date(ms).toLocaleString(locale, { hour12: false });
  const [company, profile, equipment, tags, session] = await Promise.all([
    db.company.get("company"),
    db.profiles.get(draft.profileId),
    db.equipment.where("profileId").equals(draft.profileId).sortBy("unitId"),
    db.tags.where("profileId").equals(draft.profileId).sortBy("sort"),
    draft.sessionId ? db.sessions.get(draft.sessionId) : undefined,
  ]);
  const tagById = new Map([...tags, ...(session?.tags ?? [])].map((x) => [x.id, x]));
  const from = session?.startedAt ?? 0;
  const to = session?.endedAt ?? Date.now();
  const inPeriod = (ms: number) => !session || (ms >= from && ms <= to);

  const writes = (await db.writes.where("profileId").equals(draft.profileId).sortBy("t")).filter((w) => inPeriod(w.t));
  const scans = (await db.scans.where("profileId").equals(draft.profileId).sortBy("t")).filter((s) => inPeriod(s.t));

  const communication: ReportData["communication"] = [];
  if (profile) {
    const s = profile.serial;
    const rtu = `Modbus RTU · ${s.baudRate} ${s.dataBits}${s.parity[0]!.toUpperCase()}${s.stopBits}`;
    communication.push({ label: "RTU", value: rtu });
    communication.push({ label: "TCP", value: `${profile.tcp.host}:${profile.tcp.port}` });
    communication.push({ label: "Timeout", value: `${profile.timeoutMs} ms` });
    communication.push({ label: "Unit IDs", value: [...new Set(equipment.map((e) => e.unitId))].join(", ") || "—" });
  }

  let csv: Uint8Array<ArrayBuffer> | undefined;
  let integrity: Integrity | undefined;
  const trends: ReportData["trends"] = [];
  if (session) {
    const series = await sessionSeries(session.id, session.tags);
    const markers = await db.markers.where("sessionId").equals(session.id).sortBy("t");
    const c = canonicalCsv(session.tags.map((x) => ({ id: x.id, name: x.name })), series);
    csv = c.bytes;
    integrity = { hash: await sha256Hex(c.bytes), rows: c.rows };
    // Signed by the agent when paired: proves which agent vouched for these numbers.
    const agent = useAgent.getState();
    if (agent.status === "paired" && agent.client) {
      const sig = await agent.client
        .call<{ signature: string; publicKey: string; fingerprint: string }>("report.sign", { hash: integrity.hash })
        .catch(() => undefined);
      if (sig) integrity.signature = { value: sig.signature, publicKey: sig.publicKey, fingerprint: sig.fingerprint };
    }
    const pens = session.tags.slice(0, 8).map((x) => ({ label: x.name, unit: x.unit, axis: "left" as const, series: series.get(x.id)! }));
    trends.push({
      session: session.name,
      period: `${time(session.startedAt)} – ${time(session.endedAt ?? Date.now())}`,
      image: draft.sections.trends ? await image(pens, markers, Math.max(3000, session.intervalMs * 3)) : undefined,
      stats: session.tags.map((x) => {
        const st = windowStats(series.get(x.id)!);
        return { tag: x.name, unit: x.unit ?? "", min: fmt(x, st.min), max: fmt(x, st.max), mean: fmt(x, st.mean), std: fmt(x, st.std), n: st.n, gaps: st.bad };
      }),
      markers: markers.map((m) => ({ time: time(m.t), text: m.text })),
    });
  }

  const data: ReportData = {
    lang: draft.lang,
    number: draft.number,
    date: new Date(draft.date).toLocaleDateString(locale),
    appVersion: APP_VERSION,
    company: company ?? { name: "", taxId: "", address: "", phone: "", email: "", website: "" },
    sections: draft.sections,
    identification: draft.identification,
    equipment: equipment.map((e) => ({ manufacturer: e.manufacturer, model: e.model, serialNumber: e.serialNumber, tag: e.tag, unitId: e.unitId, firmware: e.firmware })),
    communication,
    tests: draft.tests.map((test) => {
      const tag = tagById.get(test.tagId);
      const ev = evaluate(test);
      const tol = test.tolerance.kind === "pct" ? `± ${test.tolerance.value} %` : `± ${fmt(tag ?? {}, test.tolerance.value)}`;
      return {
        tag: tag?.name ?? "?",
        unit: tag?.unit ?? "",
        expected: fmt(tag ?? {}, test.expected),
        measured: test.measured ? fmt(tag ?? {}, test.measured.value) : "—",
        how: test.measured ? t.how[test.measured.how] : "",
        tolerance: tol,
        verdict: ev.verdict,
        justification: test.override?.justification,
      };
    }),
    writes: writes.map((w) => ({
      time: time(w.t),
      tag: w.tagName ?? "",
      address: `${w.unitId}:${formatClassic(w.table, w.offset)}`,
      previous: w.previous ?? "—",
      next: w.next,
      result: w.detail ? `${w.result} (${w.detail})` : w.result,
    })),
    scans: scans.map((s) => ({ time: time(s.t), kind: s.kind, params: s.params, result: s.result })),
    trends,
    observations: draft.observations,
    pending: draft.pending,
    signatures: draft.signatures,
    integrity,
    csvAttached: Boolean(csv && draft.attachCsv),
  };
  return { data, csv: draft.attachCsv ? csv : undefined, csvName: `${draft.number}-dados.csv` };
}

/** The PDF: react-pdf renders, pdf-lib adds the integrity metadata and the CSV. */
export async function renderPdf(built: Awaited<ReturnType<typeof buildReport>>): Promise<Blob> {
  const [{ pdf }, { ReportDocument }, { createElement }] = await Promise.all([import("@react-pdf/renderer"), import("@modfield/report/document"), import("react")]);
  const raw = new Uint8Array(await (await pdf(createElement(ReportDocument, { data: built.data }) as never).toBlob()).arrayBuffer());
  const final = await finalizePdf(raw, built.data.integrity, built.csv, built.csvName);
  return new Blob([final as BlobPart], { type: "application/pdf" });
}
