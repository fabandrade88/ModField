"use client";
import { describeRtuFrame, formatClassic, type FoundFrame, type Table } from "@modfield/protocol";
import {
  SimulatedSerialPort,
  demoSlaves,
  detectPassive,
  detectSerial,
  discoverRegisters,
  formatLine,
  idScanOrder,
  scanIds,
  scanTimeoutMs,
  type AddressRange,
  type LineSettings,
  type Progress as P,
  type ScanHit,
  type SerialPortLike,
} from "@modfield/transport";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState, type ReactNode } from "react";
import { Button, Dialog, ErrorBox, Field, Input, Notice, Progress, Section, Select, Tabs } from "@/components/controls";
import { useT } from "@/components/i18n";
import { db, newId, type ScanKind } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { updateProfile, useEquipment, useProfile, useTags } from "@/lib/hooks";
import { demoLine, useConnection } from "@/store/connection";
import { useUi, type ScanTab } from "@/store/ui";

function record(profileId: string, kind: ScanKind, params: string, result: string) {
  void db.scans.add({ t: Date.now(), profileId, kind, params, result });
}

/** Scans run only after this warning: old devices can hang under a scan. */
function useScanGuard() {
  const t = useT();
  const [pending, setPending] = useState<() => void>();
  const guard = (run: () => void) => setPending(() => run);
  const dialog = (
    <Dialog
      open={Boolean(pending)}
      onClose={() => setPending(undefined)}
      title={t("scan.warn.title")}
      footer={
        <>
          <Button onClick={() => setPending(undefined)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              pending?.();
              setPending(undefined);
            }}
          >
            {t("scan.warn.go")}
          </Button>
        </>
      }
    >
      {t("scan.warn.body")}
    </Dialog>
  );
  return { guard, dialog };
}

export function ScanModule() {
  const t = useT();
  const tab = useUi((s) => s.scanTab);
  const set = useUi((s) => s.set);
  return (
    <div className="flex flex-col gap-4 p-3">
      <Tabs
        value={tab}
        onChange={(scanTab: ScanTab) => set({ scanTab })}
        tabs={[
          ["ids", t("scan.tab.ids")],
          ["serial", t("scan.tab.serial")],
          ["passive", t("scan.tab.passive")],
          ["registers", t("scan.tab.registers")],
        ]}
      />
      {tab === "ids" && <IdScan />}
      {tab === "serial" && <SerialScan />}
      {tab === "passive" && <PassiveScan />}
      {tab === "registers" && <RegisterScan />}
      <ScanLog />
    </div>
  );
}

function useRun() {
  const [progress, setProgress] = useState<P>();
  const [error, setError] = useState<unknown>();
  const ac = useRef<AbortController>(undefined);
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    ac.current = new AbortController();
    setError(undefined);
    setProgress({ done: 0, total: 1, label: "" });
    try {
      await fn(ac.current.signal);
    } catch (e) {
      setError(e);
    } finally {
      setProgress(undefined);
    }
  };
  return { progress, setProgress, error, run, stop: () => ac.current?.abort(), running: progress !== undefined };
}

function IdScan() {
  const t = useT();
  const client = useConnection((s) => s.client);
  const transport = useConnection((s) => s.transport);
  const profile = useProfile();
  const equipment = useEquipment();
  const baud = profile?.serial.baudRate ?? 9600;
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(247);
  const [timeoutMs, setTimeoutMs] = useState<number>();
  const [hits, setHits] = useState<ScanHit[]>([]);
  const { guard, dialog } = useScanGuard();
  const r = useRun();
  const effTimeout = timeoutMs ?? scanTimeoutMs(transport?.kind === "mock" ? 19200 : baud);

  const start = () =>
    guard(() =>
      void r.run(async (signal) => {
        if (!transport || !profile) return;
        setHits([]);
        const found = await scanIds(transport, {
          ids: idScanOrder(from, to),
          timeoutMs: effTimeout,
          signal,
          onProgress: (p, h) => {
            r.setProgress(p);
            setHits([...h]);
          },
        });
        setHits(found);
        record(profile.id, "ids", `${from}..${to} · ${effTimeout} ms`, found.map((h) => h.unitId).join(", ") || "—");
      }),
    );

  const addEquipment = (unitId: number) =>
    profile &&
    void db.equipment.add({ id: newId(), profileId: profile.id, unitId, manufacturer: "", model: "", serialNumber: "", tag: "", firmware: "" });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t("scan.ids.help")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("scan.from")}>
          <Input type="number" min={1} max={247} value={from} onChange={(e) => setFrom(clamp(e.target.valueAsNumber, 1, 247, 1))} className="w-20" />
        </Field>
        <Field label={t("scan.to")}>
          <Input type="number" min={1} max={247} value={to} onChange={(e) => setTo(clamp(e.target.valueAsNumber, 1, 247, 247))} className="w-20" />
        </Field>
        <Field label={t("conn.timeout")}>
          <Input
            type="number"
            min={10}
            max={2000}
            value={effTimeout}
            onChange={(e) => setTimeoutMs(clamp(e.target.valueAsNumber, 10, 2000, 100))}
            className="w-24"
          />
        </Field>
        {r.running ? <Button onClick={r.stop}>{t("scan.stop")}</Button> : <Button variant="primary" disabled={!client} onClick={start}>{t("scan.start")}</Button>}
        {r.progress && <Progress {...r.progress} />}
      </div>
      {!client && <p className="text-muted">{t("read.notConnected")}</p>}
      {r.error !== undefined && <ErrorBox {...describeError(t, r.error)} />}
      {hits.length > 0 && (
        <table className="text-left">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="pr-4 font-normal">ID</th>
              <th className="pr-4 font-normal">{t("scan.answer")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.unitId} className="h-8 border-b border-border/50">
                <td className="pr-4 tabular-nums">{h.unitId}</td>
                <td className={`pr-4 ${h.answer === "exception" ? "text-warning" : ""}`}>
                  {h.answer === "ok" ? t("scan.answer.ok") : t("scan.answer.exception", { code: String(h.exception ?? 0).padStart(2, "0") })}
                </td>
                <td>
                  {!equipment.some((e) => e.unitId === h.unitId) && (
                    <Button onClick={() => addEquipment(h.unitId)}>{t("scan.addEquipment")}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {dialog}
    </div>
  );
}

/** The port, released from any connection; the demo uses its simulated line. */
async function acquirePort(passive: boolean): Promise<{ port: SerialPortLike; demo: boolean } | undefined> {
  const c = useConnection.getState();
  const demo = c.transport?.kind === "mock" || (!c.port && c.last?.kind === "mock");
  if (c.transport) await c.disconnect();
  // A simulated bus with another master on it, so passive listening has something to hear.
  if (demo) return { port: passive ? new SimulatedSerialPort(demoSlaves(), { chatterMs: 120 }) : demoLine(), demo };
  return c.port ? { port: c.port, demo: false } : undefined;
}

function PortRequired({ children }: { children: ReactNode }) {
  const t = useT();
  const port = useConnection((s) => s.port);
  const last = useConnection((s) => s.last);
  const transport = useConnection((s) => s.transport);
  if (port || last?.kind === "mock" || transport?.kind === "mock") return <>{children}</>;
  return <Notice>{t("scan.needsPort")}</Notice>;
}

function ApplySettings({ settings }: { settings: LineSettings }) {
  const t = useT();
  const profile = useProfile();
  const c = useConnection();
  if (!profile) return null;
  const apply = async () => {
    updateProfile(profile.id, { serial: { ...profile.serial, ...settings } });
    if (c.last?.kind === "mock" || !c.port) await c.connectDemo(profile.timeoutMs);
    else await c.connectSerial({ ...profile.serial, ...settings }, profile.timeoutMs);
  };
  return <Button variant="primary" onClick={() => void apply()}>{t("scan.apply")}</Button>;
}

function SerialScan() {
  const t = useT();
  const profile = useProfile();
  const setBusy = useConnection((s) => s.setPortBusy);
  const [idsText, setIdsText] = useState("1, 2, 247");
  const [found, setFound] = useState<{ settings: LineSettings; unitId: number } | null>();
  const { guard, dialog } = useScanGuard();
  const r = useRun();
  const ids = idsText
    .split(/[\s,;]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 247);

  const start = () =>
    guard(() =>
      void r.run(async (signal) => {
        if (!profile) return;
        const p = await acquirePort(false);
        if (!p) return;
        setBusy(true);
        setFound(undefined);
        try {
          const res = await detectSerial(p.port, { ids, signal, onProgress: r.setProgress });
          setFound(res ? { settings: res.settings, unitId: res.hit.unitId } : null);
          record(profile.id, "serial", `IDs ${ids.join(", ")}`, res ? `${formatLine(res.settings)} · ID ${res.hit.unitId}` : "—");
        } finally {
          setBusy(false);
        }
      }),
    );

  return (
    <PortRequired>
      <div className="flex flex-col gap-3">
        <p className="text-muted">{t("scan.serial.help")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("scan.serial.ids")}>
            <Input value={idsText} onChange={(e) => setIdsText(e.target.value)} className="w-40" />
          </Field>
          {r.running ? <Button onClick={r.stop}>{t("scan.stop")}</Button> : <Button variant="primary" disabled={!ids.length} onClick={start}>{t("scan.start")}</Button>}
          {r.progress && <Progress {...r.progress} />}
        </div>
        {r.error !== undefined && <ErrorBox {...describeError(t, r.error)} />}
        {found && (
          <div className="flex flex-wrap items-center gap-3 border border-border px-3 py-2">
            <span>{t("scan.serial.found", { settings: formatLine(found.settings), id: found.unitId })}</span>
            <ApplySettings settings={found.settings} />
          </div>
        )}
        {found === null && <Notice tone="warning">{t("scan.serial.none")}</Notice>}
        {dialog}
      </div>
    </PortRequired>
  );
}

function PassiveScan() {
  const t = useT();
  const profile = useProfile();
  const setBusy = useConnection((s) => s.setPortBusy);
  const [ms, setMs] = useState(1500);
  const [found, setFound] = useState<{ settings: LineSettings; frames: FoundFrame[]; demo: boolean } | null>();
  const r = useRun();

  // Listening transmits nothing, so no warning is needed.
  const start = () =>
    void r.run(async (signal) => {
      if (!profile) return;
      const p = await acquirePort(true);
      if (!p) return;
      setBusy(true);
      setFound(undefined);
      try {
        const res = await detectPassive(p.port, { msPerCandidate: ms, signal, onProgress: r.setProgress });
        setFound(res ? { ...res, demo: p.demo } : null);
        record(profile.id, "passive", `${ms} ms/comb.`, res ? `${formatLine(res.settings)} · ${res.frames.length}×` : "—");
      } finally {
        setBusy(false);
      }
    });

  return (
    <PortRequired>
      <div className="flex flex-col gap-3">
        <p className="text-muted">{t("scan.passive.help")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("scan.passive.ms")}>
            <Input type="number" min={200} max={10000} step={100} value={ms} onChange={(e) => setMs(clamp(e.target.valueAsNumber, 200, 10000, 1500))} className="w-28" />
          </Field>
          {r.running ? <Button onClick={r.stop}>{t("scan.stop")}</Button> : <Button variant="primary" onClick={start}>{t("scan.listen")}</Button>}
          {r.progress && <Progress {...r.progress} />}
        </div>
        {r.error !== undefined && <ErrorBox {...describeError(t, r.error)} />}
        {found && (
          <div className="flex flex-col gap-2 border border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <span>{t("scan.passive.found", { settings: formatLine(found.settings), n: found.frames.length })}</span>
              <ApplySettings settings={found.settings} />
            </div>
            {found.demo && <span className="text-[12px] text-muted">{t("scan.passive.demo")}</span>}
            <ul className="text-[12px] text-muted">
              {found.frames.slice(0, 6).map((f, i) => (
                <li key={i}>
                  {f.kind === "request" ? "TX" : "RX"} · {t("read.unit")} {f.frame[0]} · {describeRtuFrame(f.frame, f.kind === "request" ? "tx" : "rx").text}
                </li>
              ))}
            </ul>
          </div>
        )}
        {found === null && <Notice tone="warning">{t("scan.passive.none")}</Notice>}
      </div>
    </PortRequired>
  );
}

function RegisterScan() {
  const t = useT();
  const client = useConnection((s) => s.client);
  const profile = useProfile();
  const tags = useTags();
  const [unitId, setUnitId] = useState(1);
  const [table, setTable] = useState<Table>("holding");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(199);
  const [ranges, setRanges] = useState<AddressRange[]>([]);
  const { guard, dialog } = useScanGuard();
  const r = useRun();

  const start = () =>
    guard(() =>
      void r.run(async (signal) => {
        if (!client || !profile) return;
        setRanges([]);
        const res = await discoverRegisters(client, {
          unitId,
          table,
          from,
          to,
          signal,
          onProgress: (p, found) => {
            r.setProgress(p);
            setRanges(found);
          },
        });
        setRanges(res);
        record(profile.id, "registers", `ID ${unitId} · ${table} ${from}..${to}`, res.map((x) => (x.start === x.end ? x.start : `${x.start}-${x.end}`)).join(", ") || "—");
      }),
    );

  const count = ranges.reduce((n, x) => n + x.end - x.start + 1, 0);
  const createTags = async () => {
    if (!profile) return;
    const addrs = ranges.flatMap((x) => Array.from({ length: x.end - x.start + 1 }, (_, i) => x.start + i)).slice(0, 125);
    await db.tags.bulkAdd(
      addrs.map((offset, i) => ({
        id: newId(),
        profileId: profile.id,
        sort: tags.length + i,
        name: `${unitId}:${formatClassic(table, offset)}`,
        unitId,
        table,
        offset,
        type: "UINT16" as const,
        order: "ABCD" as const,
      })),
    );
    useUi.getState().set({ readTab: "tags" });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t("scan.registers.help")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("read.unit")}>
          <Input type="number" min={1} max={247} value={unitId} onChange={(e) => setUnitId(clamp(e.target.valueAsNumber, 1, 247, 1))} className="w-20" />
        </Field>
        <Field label={t("read.table")}>
          <Select
            value={table}
            options={[
              { value: "holding", label: t("read.table.holding") },
              { value: "input", label: t("read.table.input") },
              { value: "coil", label: t("read.table.coil") },
              { value: "discrete", label: t("read.table.discrete") },
            ] as const}
            onChange={setTable}
          />
        </Field>
        <Field label={t("scan.from")}>
          <Input type="number" min={0} max={65535} value={from} onChange={(e) => setFrom(clamp(e.target.valueAsNumber, 0, 65535, 0))} className="w-24" />
        </Field>
        <Field label={t("scan.to")}>
          <Input type="number" min={0} max={65535} value={to} onChange={(e) => setTo(clamp(e.target.valueAsNumber, 0, 65535, 199))} className="w-24" />
        </Field>
        {r.running ? <Button onClick={r.stop}>{t("scan.stop")}</Button> : <Button variant="primary" disabled={!client || to < from} onClick={start}>{t("scan.start")}</Button>}
        {r.progress && <Progress {...r.progress} />}
      </div>
      {!client && <p className="text-muted">{t("read.notConnected")}</p>}
      {r.error !== undefined && <ErrorBox {...describeError(t, r.error, { unit: unitId })} />}
      {ranges.length > 0 && (
        <div className="flex flex-col gap-2">
          <p>
            {t("scan.registers.found", { n: count })}:{" "}
            {ranges.map((x) => (x.start === x.end ? `${x.start}` : `${x.start}–${x.end}`)).join(", ")}
          </p>
          {!r.running && (
            <div>
              <Button onClick={() => void createTags()}>{t("scan.registers.createTags", { n: Math.min(125, count) })}</Button>
            </div>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

function ScanLog() {
  const t = useT();
  const profileId = useUi((s) => s.profileId);
  const scans = useLiveQuery(() => db.scans.where("profileId").equals(profileId).reverse().sortBy("t"), [profileId], []);
  if (!scans.length) return null;
  return (
    <Section title={t("scan.log")}>
      <table className="text-left text-[12px]">
        <tbody>
          {scans.slice(0, 20).map((s) => (
            <tr key={s.id} className="border-b border-border/50">
              <td className="pr-3 text-muted tabular-nums">{new Date(s.t).toLocaleString(undefined, { hour12: false })}</td>
              <td className="pr-3">{t(`scan.tab.${s.kind === "ip" ? "ids" : s.kind}`)}</td>
              <td className="pr-3 text-muted">{s.params}</td>
              <td>{s.result}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback;
}
