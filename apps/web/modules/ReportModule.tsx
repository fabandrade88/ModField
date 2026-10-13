"use client";
import { SECTIONS, verifyReport, type ReportLang, type SectionId, type SignatureBlock, type Verification } from "@modfield/report";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorBox, Field, Input, Notice, Section, Select, Tabs, TextArea, cx } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import { registerCommand } from "@/lib/commands";
import { db, newId, type ReportDraft } from "@/lib/db";
import { ensureDemoReport } from "@/lib/demoData";
import { download } from "@/lib/download";
import { useProfile, useTags } from "@/lib/hooks";
import { DEMO_PROFILE_ID } from "@/lib/seed";
import { LANG_NAMES } from "@/lib/i18n";
import { buildReport, newDraft, renderPdf } from "@/lib/report";
import { trendImage } from "@/lib/trendImage";
import { useAgent } from "@/store/agent";
import { useUi } from "@/store/ui";
import { SignatureDialog } from "./report/SignaturePad";
import { TestsEditor } from "./report/TestsEditor";

export function ReportModule({ pane }: { pane: number }) {
  const t = useT();
  const [tab, setTab] = useState<"report" | "verify">("report");
  return (
    <div className="flex flex-col gap-3 p-3">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ["report", t("report.tab.report")],
          ["verify", t("report.tab.verify")],
        ]}
      />
      {tab === "report" ? <ReportEditor pane={pane} /> : <VerifyTab />}
    </div>
  );
}

function ReportEditor({ pane }: { pane: number }) {
  const t = useT();
  const lang = useLang();
  const profile = useProfile();
  const tags = useTags();
  const company = useLiveQuery(() => db.company.get("company"), []);
  const drafts = useLiveQuery(() => (profile ? db.reports.where("profileId").equals(profile.id).reverse().sortBy("createdAt") : []), [profile?.id], []);
  const templates = useLiveQuery(() => db.templates.orderBy("name").toArray(), [], []);
  const sessions = useLiveQuery(() => (profile ? db.sessions.where("profileId").equals(profile.id).reverse().sortBy("startedAt") : []), [profile?.id], []);
  const [draftId, setDraftId] = useState<string>();
  const stored = drafts.find((d) => d.id === draftId) ?? drafts[0];
  // Optimistic local copy: checkboxes and fields answer at once; IndexedDB catches up.
  const [local, setLocal] = useState<ReportDraft>();
  useEffect(() => {
    if (stored && stored.id !== local?.id) setLocal(stored);
  }, [stored, local?.id]);
  const draft = local && local.id === stored?.id ? local : stored;
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const session = sessions.find((s) => s.id === draft?.sessionId);
  const markers = useLiveQuery(() => (session ? db.markers.where("sessionId").equals(session.id).sortBy("t") : []), [session?.id], []);
  const agentPaired = useAgent((s) => s.status === "paired");
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState<"preview" | "pdf">();
  const [error, setError] = useState<unknown>();
  const [signing, setSigning] = useState<SignatureBlock["role"]>();
  const previewUrl = useRef<string>(undefined);

  const up = (patch: Partial<ReportDraft>) => {
    if (!draft) return;
    const next = { ...draft, ...patch, updatedAt: Date.now() };
    setLocal(next);
    saving.current = saving.current.then(() => db.reports.put(next));
  };
  const create = async () => {
    if (!profile) return;
    const d = await newDraft(profile.id, lang);
    setDraftId(d.id);
    setLocal(d);
  };

  const build = async (id = draft!.id) => {
    await saving.current;
    const d = await db.reports.get(id);
    return buildReport(d!, (pens, ms, gapMs) => trendImage(pens, ms, { gapMs, locale: d!.lang }));
  };
  const refreshPreview = async (id?: string) => {
    const target = id ?? draft?.id;
    if (!target) return;
    setBusy("preview");
    setError(undefined);
    try {
      const blob = await renderPdf(await build(target));
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = URL.createObjectURL(blob);
      setPreview(previewUrl.current);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  const generate = async () => {
    if (!draft) return;
    setBusy("pdf");
    setError(undefined);
    try {
      const blob = await renderPdf(await build(draft.id));
      download(`${draft.number}.pdf`, blob, "application/pdf");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  };
  // Demo profile: a fully-filled example report (with a logged session), previewed at once.
  const loadDemo = async () => {
    if (!profile) return;
    setError(undefined);
    try {
      const id = await ensureDemoReport(profile.id, draft?.lang ?? lang);
      setDraftId(id);
      setLocal(await db.reports.get(id));
      void refreshPreview(id);
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => registerCommand("report.generate", pane, () => void generate()));
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const applyTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id);
    if (!draft || !tpl) return up({ templateId: undefined });
    const byName = new Map(tags.map((x) => [x.name, x]));
    up({
      templateId: tpl.id,
      lang: tpl.lang,
      sections: tpl.sections,
      identification: { ...draft.identification, client: draft.identification.client || tpl.name },
      tests: tpl.tests.filter((x) => byName.has(x.tagName)).map((x) => ({ id: newId(), tagId: byName.get(x.tagName)!.id, expected: x.expected, tolerance: x.tolerance })),
      signatures: draft.signatures.map((s) => ({ ...s, enabled: tpl.signatures.includes(s.role) })),
    });
  };
  const saveTemplate = async () => {
    if (!draft) return;
    const name = draft.identification.client.trim() || t("report.template.unnamed");
    const existing = templates.find((x) => x.name === name);
    const tagName = new Map(tags.map((x) => [x.id, x.name]));
    const tpl = {
      id: existing?.id ?? newId(),
      name,
      lang: draft.lang,
      sections: draft.sections,
      tests: draft.tests.filter((x) => tagName.has(x.tagId)).map((x) => ({ tagName: tagName.get(x.tagId)!, expected: x.expected, tolerance: x.tolerance })),
      signatures: draft.signatures.filter((s) => s.enabled).map((s) => s.role),
    };
    await db.templates.put(tpl);
    up({ templateId: tpl.id });
  };

  if (!profile) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {!company?.name && <Notice tone="warning">{t("report.noCompany")}</Notice>}
        <div className="flex flex-wrap items-end gap-2">
          {drafts.length > 0 && (
            <Field label={t("report.draft")}>
              <Select
                value={draft?.id ?? ""}
                options={drafts.map((d) => ({ value: d.id, label: `${d.number} · ${d.identification.client || "—"}` }))}
                onChange={setDraftId}
                className="w-72"
              />
            </Field>
          )}
          <Button variant={drafts.length ? "default" : "primary"} onClick={() => void create()}>
            {t("report.new")}
          </Button>
          {profile.id === DEMO_PROFILE_ID && (
            <Button variant={drafts.length ? "default" : "primary"} onClick={() => void loadDemo()}>
              {t("report.demo")}
            </Button>
          )}
        </div>
        {!draft ? (
          <p className="text-muted">{t("report.empty")}</p>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
              <Field label={t("report.number")}>
                <Input value={draft.number} onChange={(e) => up({ number: e.target.value })} />
              </Field>
              <Field label={t("report.date")}>
                <Input type="date" value={new Date(draft.date).toISOString().slice(0, 10)} onChange={(e) => e.target.valueAsDate && up({ date: e.target.valueAsDate.getTime() })} />
              </Field>
              <Field label={t("report.lang")}>
                <Select value={draft.lang} options={(["pt", "en", "de"] as ReportLang[]).map((l) => ({ value: l, label: LANG_NAMES[l] }))} onChange={(l) => up({ lang: l })} />
              </Field>
              <Field label={t("report.template")}>
                <Select
                  value={draft.templateId ?? ""}
                  options={[{ value: "", label: "—" }, ...templates.map((x) => ({ value: x.id, label: x.name }))]}
                  onChange={applyTemplate}
                />
              </Field>
            </div>
            <div>
              <Button variant="ghost" onClick={() => void saveTemplate()}>
                {t("report.template.save")}
              </Button>
            </div>

            <Section title={t("report.identification")}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                {(["client", "plant", "area", "project", "responsible"] as const).map((k) => (
                  <Field key={k} label={t(`report.id.${k}`)}>
                    <Input value={draft.identification[k]} onChange={(e) => up({ identification: { ...draft.identification, [k]: e.target.value } })} />
                  </Field>
                ))}
              </div>
            </Section>

            <Section title={t("report.session")}>
              <Select
                aria-label={t("report.session")}
                value={draft.sessionId ?? ""}
                options={[
                  { value: "", label: t("report.session.none") },
                  ...sessions.filter((s) => s.status !== "running").map((s) => ({ value: s.id, label: `${s.name} · ${new Date(s.startedAt).toLocaleString(lang, { hour12: false })}` })),
                ]}
                onChange={(id) => up({ sessionId: id || undefined })}
                className="max-w-xl"
              />
              <p className="text-[12px] text-muted">{agentPaired ? t("report.integrity.signed") : t("report.integrity.unsigned")}</p>
              <label className="flex min-h-8 items-center gap-2">
                <input type="checkbox" className="size-4" checked={draft.attachCsv} onChange={(e) => up({ attachCsv: e.target.checked })} disabled={!session} />
                {t("report.attachCsv")}
              </label>
            </Section>

            <Section title={t("report.sections")}>
              <div className="flex flex-wrap gap-x-4">
                {SECTIONS.map((id: SectionId) => (
                  <label key={id} className="flex min-h-8 items-center gap-2">
                    <input type="checkbox" className="size-4" checked={draft.sections[id]} onChange={(e) => up({ sections: { ...draft.sections, [id]: e.target.checked } })} />
                    {t(`report.section.${id}`)}
                  </label>
                ))}
              </div>
            </Section>

            <Section title={t("report.section.tests")}>
              <TestsEditor tests={draft.tests} tags={tags} session={session} markers={markers} onChange={(tests) => up({ tests })} />
            </Section>

            <Section title={t("report.section.observations")}>
              <Field label={t("report.observations")}>
                <TextArea value={draft.observations} onChange={(e) => up({ observations: e.target.value })} rows={3} />
              </Field>
              <Field label={t("report.pending")}>
                <TextArea value={draft.pending} onChange={(e) => up({ pending: e.target.value })} rows={2} />
              </Field>
            </Section>

            <Section title={t("report.section.signatures")}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
                {draft.signatures.map((s, i) => {
                  const set = (patch: Partial<SignatureBlock>) => up({ signatures: draft.signatures.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                  return (
                    <fieldset key={s.role} className={cx("flex min-w-0 flex-col gap-2 border border-border p-2", !s.enabled && "opacity-70")}>
                      <label className="flex min-h-8 items-center gap-2">
                        <input type="checkbox" className="size-4" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                        {t(`report.role.${s.role}`)}
                      </label>
                      {(["name", "function", "company", "date"] as const).map((k) => (
                        <Field key={k} label={t(`report.sign.${k}`)}>
                          <Input value={s[k]} onChange={(e) => set({ [k]: e.target.value })} disabled={!s.enabled} className="w-full min-w-0" />
                        </Field>
                      ))}
                      {s.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.image} alt={t("report.sign.drawn")} className="h-16 border border-border bg-white object-contain" />
                      ) : (
                        <p className="text-[12px] text-muted">{t("report.sign.blank")}</p>
                      )}
                      <div className="flex flex-wrap gap-1">
                        <Button onClick={() => setSigning(s.role)} disabled={!s.enabled}>
                          {t("report.sign.draw")}
                        </Button>
                        {s.image && (
                          <Button variant="ghost" onClick={() => set({ image: undefined })}>
                            {t("report.sign.clear")}
                          </Button>
                        )}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              <p className="text-[12px] text-muted">{t("report.sign.note")}</p>
            </Section>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void refreshPreview()} disabled={busy !== undefined}>
                {busy === "preview" ? "…" : t("report.preview")}
              </Button>
              <Button variant="primary" onClick={() => void generate()} disabled={busy !== undefined} shortcut="G">
                {busy === "pdf" ? "…" : t("report.generate")}
              </Button>
            </div>
            {error !== undefined && <ErrorBox tag="!" message={error instanceof Error ? error.message : String(error)} />}
          </>
        )}
      </div>
      {/* The preview stays beside the form while it scrolls. */}
      <div className="min-w-0 xl:sticky xl:top-0 xl:self-start">
        {preview ? (
          <iframe title={t("report.preview")} src={preview} className="h-[80vh] w-full border border-border bg-white" />
        ) : (
          draft && <p className="flex h-64 items-center justify-center border border-dashed border-border text-muted">{t("report.preview.hint")}</p>
        )}
      </div>
      <SignatureDialog
        open={signing !== undefined}
        title={signing ? t(`report.role.${signing}`) : ""}
        onClose={() => setSigning(undefined)}
        onSave={(png) => draft && up({ signatures: draft.signatures.map((x) => (x.role === signing ? { ...x, image: png } : x)) })}
      />
    </div>
  );
}

/** Does this CSV match this report's hash, and did the agent sign it? */
function VerifyTab() {
  const t = useT();
  const [pdf, setPdf] = useState<File>();
  const [csv, setCsv] = useState<File>();
  const [result, setResult] = useState<Verification>();
  const [error, setError] = useState<string>();

  const run = async () => {
    if (!pdf || !csv) return;
    setError(undefined);
    try {
      setResult(await verifyReport(new Uint8Array(await pdf.arrayBuffer()), new Uint8Array(await csv.arrayBuffer())));
    } catch (e) {
      setResult(undefined);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const line = (ok: boolean | undefined, yes: string, no: string) => (
    <p className={ok ? "" : "text-comm"}>
      {ok ? "✓" : "✕"} {ok ? yes : no}
    </p>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="text-muted">{t("report.verify.help")}</p>
      <Field label={t("report.verify.pdf")}>
        <input type="file" accept="application/pdf,.pdf" className="min-h-8" aria-label={t("report.verify.pdf")} onChange={(e) => setPdf(e.target.files?.[0])} />
      </Field>
      <Field label={t("report.verify.csv")}>
        <input type="file" accept=".csv,text/csv" className="min-h-8" aria-label={t("report.verify.csv")} onChange={(e) => setCsv(e.target.files?.[0])} />
      </Field>
      <div>
        <Button variant="primary" disabled={!pdf || !csv} onClick={() => void run()}>
          {t("report.verify.run")}
        </Button>
      </div>
      {error && <ErrorBox tag="!" message={error} />}
      {result && (
        <div role="status" className="flex flex-col gap-1 border border-border p-3">
          {!result.integrity ? (
            <p className="text-comm">✕ {t("report.verify.noIntegrity")}</p>
          ) : (
            <>
              {line(result.csvMatches, t("report.verify.match"), t("report.verify.mismatch"))}
              {result.signed ? line(result.signatureValid, t("report.verify.sigOk", { fp: result.integrity.signature!.fingerprint }), t("report.verify.sigBad")) : <p className="text-muted">{t("report.verify.unsigned")}</p>}
              <p className="text-[12px] break-all text-muted">
                PDF {result.integrity.hash}
                <br />
                CSV {result.csvHash}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function generateFromShortcut(): void {
  useUi.getState().openModule("report");
}
