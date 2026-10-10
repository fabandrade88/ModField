"use client";
import { evaluate, type AcceptanceTest, type MeasureHow } from "@modfield/report";
import { windowStats } from "@modfield/series";
import { formatTagValue } from "@modfield/protocol";
import { useState } from "react";
import { Button, Input, Select, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { newId, type LogSession, type Marker, type TagRow } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { numericTags } from "@/lib/logger";
import { sessionSeries } from "@/lib/report";
import { useConnection } from "@/store/connection";

const VERDICT_STYLE = { pass: ["", "✓"], fail: ["text-critical", "✕"], pending: ["text-muted", "…"] } as const;

/** Acceptance tests: tag, expected, tolerance, measured (now or from the session), verdict. */
export function TestsEditor({
  tests,
  tags,
  session,
  markers,
  onChange,
}: {
  tests: AcceptanceTest[];
  tags: TagRow[];
  session: LogSession | undefined;
  markers: Marker[];
  onChange: (tests: AcceptanceTest[]) => void;
}) {
  const t = useT();
  const client = useConnection((s) => s.client);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [window, setWindow] = useState<{ from: number; to: number }>();
  const candidates = numericTags(tags) as TagRow[];
  const tagOf = (id: string) => candidates.find((x) => x.id === id) ?? session?.tags.find((x) => x.id === id);
  const up = (id: string, patch: Partial<AcceptanceTest>) => onChange(tests.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const capture = async (test: AcceptanceTest) => {
    const tag = tagOf(test.tagId);
    if (!client || !tag) return;
    setBusy(test.id);
    setError(undefined);
    try {
      const { Poller } = await import("@modfield/transport");
      const cycle = await new Poller(client, [tag], 1000).once();
      const s = cycle.samples[0];
      if (s?.quality !== "good" || typeof s.value !== "number") throw s?.error ?? new Error("no value");
      up(test.id, { measured: { value: s.value, how: "capture", at: cycle.t } });
    } catch (e) {
      setError(describeError(t, e, { unit: tag.unitId }).message);
    } finally {
      setBusy(undefined);
    }
  };

  const fromSession = async (test: AcceptanceTest, how: Exclude<MeasureHow, "capture">) => {
    if (!session) return;
    const tag = session.tags.find((x) => x.id === test.tagId);
    if (!tag) return setError(t("report.tests.notInSession"));
    const series = (await sessionSeries(session.id, [tag])).get(tag.id)!;
    const st = windowStats(series, window?.from, window?.to);
    if (!st.n) return setError(t("report.tests.noSamples"));
    up(test.id, { measured: { value: st[how], how, at: Date.now(), from: window?.from, to: window?.to } });
  };

  const markerOptions = [
    { value: "", label: t("report.tests.window.all") },
    ...markers.map((m) => ({ value: String(m.t), label: `${new Date(m.t).toLocaleTimeString(undefined, { hour12: false })} ${m.text}` })),
  ];

  return (
    <div className="flex flex-col gap-2">
      {session && markers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">{t("report.tests.window")}</span>
          <Select
            aria-label={t("report.tests.window.from")}
            value={window ? String(window.from) : ""}
            options={markerOptions}
            onChange={(v) => setWindow(v ? { from: Number(v), to: window?.to ?? session.endedAt ?? Date.now() } : undefined)}
          />
          <span className="text-muted">→</span>
          <Select
            aria-label={t("report.tests.window.to")}
            value={window ? String(window.to) : ""}
            options={markerOptions}
            onChange={(v) => setWindow(v ? { from: window?.from ?? session.startedAt, to: Number(v) } : undefined)}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="pr-2 font-normal">{t("tag.name")}</th>
              <th className="pr-2 font-normal">{t("report.tests.expected")}</th>
              <th className="pr-2 font-normal">{t("report.tests.tolerance")}</th>
              <th className="pr-2 font-normal">{t("report.tests.measured")}</th>
              <th className="pr-2 font-normal">{t("report.tests.verdict")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tests.map((test) => {
              const tag = tagOf(test.tagId);
              let ev;
              try {
                ev = evaluate(test);
              } catch {
                ev = evaluate({ ...test, override: undefined });
              }
              const [color, sym] = VERDICT_STYLE[ev.verdict];
              return (
                <tr key={test.id} className="border-b border-border/50 align-top">
                  <td className="py-1 pr-2">
                    <Select
                      aria-label={t("tag.name")}
                      value={test.tagId}
                      options={candidates.map((x) => ({ value: x.id, label: x.name }))}
                      onChange={(tagId) => up(test.id, { tagId, measured: undefined })}
                      className="w-48"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={t("report.tests.expected")}
                      type="number"
                      step="any"
                      value={Number.isFinite(test.expected) ? test.expected : ""}
                      onChange={(e) => up(test.id, { expected: e.target.valueAsNumber })}
                      className="w-24"
                    />
                    {tag?.unit && <span className="ml-1 text-muted">{tag.unit}</span>}
                  </td>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <span className="text-muted">± </span>
                    <Input
                      aria-label={t("report.tests.tolerance")}
                      type="number"
                      step="any"
                      min={0}
                      value={test.tolerance.value}
                      onChange={(e) => up(test.id, { tolerance: { ...test.tolerance, value: Math.abs(e.target.valueAsNumber || 0) } })}
                      className="w-20"
                    />
                    <Select
                      aria-label={t("report.tests.toleranceKind")}
                      value={test.tolerance.kind}
                      options={[
                        { value: "abs", label: tag?.unit || t("report.tests.abs") },
                        { value: "pct", label: "%" },
                      ] as const}
                      onChange={(kind) => up(test.id, { tolerance: { ...test.tolerance, kind } })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <div className="tabular-nums">
                      {test.measured ? formatTagValue({ decimals: tag?.decimals, unit: tag?.unit }, test.measured.value) : "—"}
                      {test.measured && <span className="text-[12px] text-muted"> ({t(`report.how.${test.measured.how}`)})</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Button onClick={() => void capture(test)} disabled={!client || busy !== undefined}>
                        {busy === test.id ? "…" : t("report.tests.capture")}
                      </Button>
                      {session &&
                        (["mean", "min", "max"] as const).map((how) => (
                          <Button key={how} variant="ghost" onClick={() => void fromSession(test, how)}>
                            {t(`report.how.${how}`)}
                          </Button>
                        ))}
                    </div>
                  </td>
                  <td className={cx("py-1 pr-2", color)}>
                    <div>
                      {sym} {t(`report.verdict.${ev.verdict}`)}
                      {ev.manual ? " *" : ""}
                    </div>
                    <label className="mt-1 flex min-h-8 items-center gap-2 text-[12px] text-muted">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={Boolean(test.override)}
                        onChange={(e) => up(test.id, { override: e.target.checked ? { result: ev.verdict === "fail" ? "pass" : "fail", justification: "" } : undefined })}
                      />
                      {t("report.tests.manual")}
                    </label>
                    {test.override && (
                      <div className="flex flex-col gap-1">
                        <Select
                          aria-label={t("report.tests.manual")}
                          value={test.override.result}
                          options={[
                            { value: "pass", label: t("report.verdict.pass") },
                            { value: "fail", label: t("report.verdict.fail") },
                          ] as const}
                          onChange={(result) => up(test.id, { override: { ...test.override!, result } })}
                        />
                        <Input
                          aria-label={t("report.tests.justification")}
                          placeholder={t("report.tests.justification")}
                          value={test.override.justification}
                          onChange={(e) => up(test.id, { override: { ...test.override!, justification: e.target.value } })}
                          className={cx("w-56", !test.override.justification.trim() && "border-warning")}
                        />
                        {!test.override.justification.trim() && <span className="text-[12px] text-warning">! {t("report.tests.justificationRequired")}</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-1">
                    <Button variant="ghost" aria-label={t("common.delete")} onClick={() => onChange(tests.filter((x) => x.id !== test.id))}>
                      ×
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {tests.length === 0 && <p className="text-muted">{t("report.tests.empty")}</p>}
      <div>
        <Button
          disabled={!candidates.length}
          onClick={() => onChange([...tests, { id: newId(), tagId: candidates[0]!.id, expected: 0, tolerance: { kind: "pct", value: 1 } }])}
        >
          {t("report.tests.add")}
        </Button>
      </div>
      {error && <p className="text-[12px] text-comm">! {error}</p>}
    </div>
  );
}
