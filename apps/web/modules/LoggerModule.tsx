"use client";
import { csvLines, toSeries, windowStats } from "@modfield/series";
import { formatTagValue } from "@modfield/protocol";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, ErrorBox, Field, Input, Notice, Section, Select, cx } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import { TrendChart, type Range } from "@/components/TrendChart";
import { registerCommand } from "@/lib/commands";
import { db, type LogSession } from "@/lib/db";
import { download, stamp } from "@/lib/download";
import { describeError } from "@/lib/errors";
import { useProfile, useTags } from "@/lib/hooks";
import { numericTags } from "@/lib/logger";
import { useConnection } from "@/store/connection";
import { useLogger } from "@/store/logger";
import { useUi } from "@/store/ui";
import { useSessionSeries } from "./logger/useSeries";

const MAX_PENS = 8;

function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function LoggerModule({ pane }: { pane: number }) {
  const t = useT();
  const profile = useProfile();
  const running = useLogger((s) => s.session);
  const sessions = useLiveQuery(
    () => (profile ? db.sessions.where("profileId").equals(profile.id).reverse().sortBy("startedAt") : []),
    [profile?.id, running?.id, running?.status],
    [],
  );
  const [viewId, setViewId] = useState<string>();
  const view: LogSession | undefined = running ?? sessions.find((s) => s.id === viewId) ?? sessions[0];

  return (
    <div className="flex flex-col gap-4 p-3">
      {running ? <RunningBar /> : <StartForm pane={pane} />}
      {sessions.length > 0 && (
        <Field label={t("logger.session")}>
          <Select
            value={view?.id ?? ""}
            options={sessions.map((s) => ({
              value: s.id,
              label: `${s.name} · ${new Date(s.startedAt).toLocaleString(undefined, { hour12: false })} · ${t(`logger.status.${s.status}`)}`,
            }))}
            onChange={setViewId}
            disabled={Boolean(running)}
            className="max-w-xl"
          />
        </Field>
      )}
      {view && <SessionView key={view.id} session={view} />}
    </div>
  );
}

function StartForm({ pane }: { pane: number }) {
  const t = useT();
  const profile = useProfile();
  const tags = useTags();
  const client = useConnection((s) => s.client);
  const kind = useConnection((s) => s.transport?.kind);
  const start = useLogger((s) => s.start);
  const error = useLogger((s) => s.error);
  const loggable = useMemo(() => numericTags(tags), [tags]);
  const [name, setName] = useState("");
  const [intervalMs, setIntervalMs] = useState(1000);
  const [minutes, setMinutes] = useState(0);
  const [picked, setPicked] = useState<Set<string> | undefined>();
  const [confirmLong, setConfirmLong] = useState(false);
  const chosen = picked ?? new Set(loggable.map((x) => x.id));
  const viaAgent = kind === "agent";

  const go = () => {
    if (!profile) return;
    void start({
      profileId: profile.id,
      name: name.trim() || t("logger.defaultName", { date: new Date().toLocaleString(undefined, { hour12: false }) }),
      tags: loggable.filter((x) => chosen.has(x.id)) as never,
      intervalMs,
      durationMs: minutes * 60_000,
    });
  };
  // Without the agent, a long log depends on this tab staying open and in front.
  const begin = () => (!viaAgent && (minutes === 0 || minutes > 60) ? setConfirmLong(true) : go());

  useEffect(() => registerCommand("logger.toggle", pane, begin));

  return (
    <div className="flex flex-col gap-3">
      <Notice tone={viaAgent ? "neutral" : "warning"}>{viaAgent ? t("logger.agentMode") : t("logger.browserMode")}</Notice>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          begin();
        }}
      >
        <Field label={t("logger.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("logger.name.placeholder")} className="w-64" />
        </Field>
        <Field label={t("read.interval")}>
          <Input type="number" min={100} max={3600000} step={100} value={intervalMs} onChange={(e) => setIntervalMs(Math.max(100, e.target.valueAsNumber || 1000))} className="w-28" />
        </Field>
        <Field label={t("logger.duration")} hint={t("logger.duration.hint")}>
          <Input type="number" min={0} max={20160} value={minutes} onChange={(e) => setMinutes(Math.max(0, e.target.valueAsNumber || 0))} className="w-28" />
        </Field>
        <Button type="submit" variant="primary" disabled={!client || chosen.size === 0} shortcut="L">
          {t("logger.start")}
        </Button>
      </form>
      {!client && <p className="text-muted">{t("read.notConnected")}</p>}
      {error !== undefined && <ErrorBox {...describeError(t, error)} />}
      {loggable.length === 0 ? (
        <p className="text-muted">{t("tag.empty")}</p>
      ) : (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-[12px] text-muted">{t("logger.tags", { n: chosen.size, total: loggable.length })}</legend>
          {loggable.map((tag) => (
            <label key={tag.id} className="flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={chosen.has(tag.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(tag.id);
                  else next.delete(tag.id);
                  setPicked(next);
                }}
              />
              {tag.name}
            </label>
          ))}
        </fieldset>
      )}
      <Dialog
        open={confirmLong}
        onClose={() => setConfirmLong(false)}
        title={t("logger.long.title")}
        footer={
          <>
            <Button onClick={() => setConfirmLong(false)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                setConfirmLong(false);
                go();
              }}
            >
              {t("logger.long.go")}
            </Button>
          </>
        }
      >
        {t("logger.long.body")}
      </Dialog>
    </div>
  );
}

function RunningBar() {
  const t = useT();
  const s = useLogger((x) => x.session)!;
  const samples = useLogger((x) => x.samples);
  const warning = useLogger((x) => x.warning);
  const stop = useLogger((x) => x.stop);
  const set = useUi((x) => x.set);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => registerCommand("logger.toggle", -1, () => void stop()), [stop]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 border border-accent px-3 py-2">
        <span>● {t("logger.recording", { name: s.name })}</span>
        <span className="text-muted tabular-nums">
          {duration(now - s.startedAt)}
          {s.stopAt ? ` / ${duration(s.stopAt - s.startedAt)}` : ""} · {t("logger.samples", { n: samples })} · {t(`logger.source.${s.source}`)}
        </span>
        <span className="flex-1" />
        <Button onClick={() => set({ markerOpen: true })} shortcut="M">
          {t("logger.marker")}
        </Button>
        <Button variant="primary" onClick={() => void stop()} shortcut="L">
          {t("logger.stop")}
        </Button>
      </div>
      {s.source === "browser" && <Notice tone="warning">{t("logger.browserMode")}</Notice>}
      {warning === "lowDisk" && <Notice tone="warning">{t("logger.lowDisk")}</Notice>}
      <p className="text-[12px] text-muted">{t("logger.sleepHint")}</p>
    </div>
  );
}

function SessionView({ session }: { session: LogSession }) {
  const t = useT();
  const lang = useLang();
  const theme = useUi((s) => s.theme);
  const [pens, setPens] = useState<{ tagId: string; axis: "left" | "right" }[]>(() =>
    session.tags.slice(0, Math.min(4, MAX_PENS)).map((x) => ({ tagId: x.id, axis: "left" as const })),
  );
  const [range, setRange] = useState<Range>();
  const version = useLogger((s) => s.version);
  const markers = useLiveQuery(() => db.markers.where("sessionId").equals(session.id).sortBy("t"), [session.id, version], []);
  const series = useSessionSeries(session, pens.map((p) => p.tagId));
  const tagById = new Map(session.tags.map((x) => [x.id, x]));

  const togglePen = (tagId: string) =>
    setPens((ps) => (ps.some((p) => p.tagId === tagId) ? ps.filter((p) => p.tagId !== tagId) : ps.length >= MAX_PENS ? ps : [...ps, { tagId, axis: "left" }]));

  const chartPens = pens
    .map((p, i) => {
      const tag = tagById.get(p.tagId);
      const s = series.get(p.tagId);
      return tag && s ? { tagId: p.tagId, label: tag.name, unit: tag.unit, axis: p.axis, color: i % 8, series: s } : undefined;
    })
    .filter((p) => p !== undefined);

  const span = (() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of chartPens) {
      if (p.series.t.length) {
        lo = Math.min(lo, p.series.t[0]!);
        hi = Math.max(hi, p.series.t[p.series.t.length - 1]!);
      }
    }
    return Number.isFinite(lo) ? { from: lo, to: hi } : undefined;
  })();
  const pan = (dir: -1 | 1) => {
    const r = range ?? span;
    if (!r) return;
    const w = r.to - r.from;
    setRange({ from: r.from + (dir * w) / 2, to: r.to + (dir * w) / 2 });
  };

  const exportCsv = async () => {
    const all = await Promise.all(
      session.tags.map(async (tag) => [tag.id, toSeries(await db.blocks.where("[sessionId+tagId]").equals([session.id, tag.id]).toArray())] as const),
    );
    const parts: string[] = [];
    let chunk: string[] = [];
    for (const line of csvLines(session.tags.map((x) => ({ id: x.id, name: x.name })), new Map(all))) {
      chunk.push(line);
      if (chunk.length >= 10_000) {
        parts.push(chunk.join("\n") + "\n");
        chunk = [];
      }
    }
    parts.push(chunk.join("\n") + "\n");
    download(`modfield-${session.name.replace(/[^\w.-]+/g, "_")}-${stamp(new Date(session.startedAt))}.csv`, new Blob(parts, { type: "text/csv" }), "text/csv");
  };

  return (
    <div className="flex flex-col gap-3">
      <Section
        title={t("logger.trend")}
        actions={
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" aria-label={t("logger.panLeft")} onClick={() => pan(-1)}>
              ←
            </Button>
            <Button variant="ghost" aria-label={t("logger.panRight")} onClick={() => pan(1)}>
              →
            </Button>
            <Button variant="ghost" onClick={() => setRange(undefined)} disabled={!range}>
              {t("logger.fit")}
            </Button>
            <Button onClick={() => void exportCsv()}>{t("logger.exportCsv")}</Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {session.tags.map((tag) => {
            const i = pens.findIndex((p) => p.tagId === tag.id);
            const on = i >= 0;
            return (
              <span key={tag.id} className="flex items-center gap-1">
                <label className="flex min-h-8 items-center gap-2">
                  <input type="checkbox" className="size-4" checked={on} disabled={!on && pens.length >= MAX_PENS} onChange={() => togglePen(tag.id)} />
                  {on && <span aria-hidden className={cx("inline-block h-0.5 w-4", `pen-swatch-${(i % 8) + 1}`)} />}
                  {tag.name}
                </label>
                {on && (
                  <button
                    type="button"
                    className="min-h-8 min-w-8 border border-border text-[11px] text-muted"
                    title={t("logger.axis.toggle")}
                    onClick={() => setPens((ps) => ps.map((p) => (p.tagId === tag.id ? { ...p, axis: p.axis === "left" ? "right" : "left" } : p)))}
                  >
                    {pens[i]!.axis === "left" ? t("logger.axis.left") : t("logger.axis.right")}
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {chartPens.length ? (
          <TrendChart
            pens={chartPens}
            markers={markers}
            range={range}
            onRange={setRange}
            gapMs={Math.max(3000, session.intervalMs * 3)}
            theme={theme}
            waiting={t("logger.waiting")}
            locale={lang}
            timeLabel={t("traffic.time")}
          />
        ) : (
          <p className="text-muted">{t("logger.noPens")}</p>
        )}
        <p className="text-[12px] text-muted">{t("logger.zoomHint")}</p>
      </Section>

      <Section title={t("logger.stats", { window: range ? `${new Date(range.from).toLocaleTimeString(lang, { hour12: false })} – ${new Date(range.to).toLocaleTimeString(lang, { hour12: false })}` : t("logger.all") })}>
        <table className="w-full text-left">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="pr-3 font-normal">{t("tag.name")}</th>
              <th className="pr-3 font-normal">{t("logger.min")}</th>
              <th className="pr-3 font-normal">{t("logger.max")}</th>
              <th className="pr-3 font-normal">{t("logger.mean")}</th>
              <th className="pr-3 font-normal">{t("logger.std")}</th>
              <th className="pr-3 font-normal">{t("logger.n")}</th>
              <th className="font-normal">{t("logger.bad")}</th>
            </tr>
          </thead>
          <tbody>
            {chartPens.map((p) => {
              const st = windowStats(p.series, range?.from, range?.to);
              const tag = tagById.get(p.tagId)!;
              const f = (v: number) => (Number.isFinite(v) ? formatTagValue({ decimals: tag.decimals, unit: undefined }, v) : "—");
              return (
                <tr key={p.tagId} className="h-8 border-b border-border/50 tabular-nums">
                  <td className="pr-3">
                    {tag.name}
                    {tag.unit ? <span className="text-muted"> ({tag.unit})</span> : null}
                  </td>
                  <td className="pr-3">{f(st.min)}</td>
                  <td className="pr-3">{f(st.max)}</td>
                  <td className="pr-3">{f(st.mean)}</td>
                  <td className="pr-3">{f(st.std)}</td>
                  <td className="pr-3">{st.n}</td>
                  <td className={st.bad ? "text-comm" : "text-muted"}>{st.bad ? `! ${st.bad}` : "0"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {markers.length > 0 && (
        <Section title={t("logger.markers")}>
          <ul>
            {markers.map((m) => (
              <li key={m.id} className="flex min-h-8 items-center gap-3">
                <span className="text-muted tabular-nums">{new Date(m.t).toLocaleTimeString(lang, { hour12: false })}</span>
                <span>▾ {m.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** M: event marker on the running session ("válvula aberta 50%"). */
export function MarkerDialog() {
  const t = useT();
  const open = useUi((s) => s.markerOpen);
  const set = useUi((s) => s.set);
  const add = useLogger((s) => s.addMarker);
  const [text, setText] = useState("");
  const close = () => {
    set({ markerOpen: false });
    setText("");
  };
  return (
    <Dialog open={open} onClose={close} title={t("logger.marker.title")} className="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(text).then(close);
        }}
        className="flex flex-col gap-3"
      >
        <Field label={t("logger.marker.text")}>
          <Input data-autofocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t("logger.marker.placeholder")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            {t("logger.marker.add")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
