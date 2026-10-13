"use client";
import { BYTE_ORDERS, DATA_TYPES, describePdu, type ByteOrder, type DataType, type Table } from "@modfield/protocol";
import { DEMO_SLAVES, fromHex, type AgentClient, type Generator, type SimPoint, type SimSlaveConfig } from "@modfield/transport";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Field, Input, Notice, Section, Select, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { db, newId, type SimSetup } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { useAgent } from "@/store/agent";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";

const GENERATORS: Generator["kind"][] = ["fixed", "ramp", "sine", "random", "counter"];

function defaultGenerator(kind: Generator["kind"]): Generator {
  switch (kind) {
    case "fixed":
      return { kind, value: 0 };
    case "ramp":
      return { kind, min: 0, max: 100, periodMs: 60_000 };
    case "sine":
      return { kind, offset: 50, amplitude: 10, periodMs: 30_000 };
    case "random":
      return { kind, min: 0, max: 100 };
    case "counter":
      return { kind, step: 1, intervalMs: 1000 };
  }
}

function demoSetup(): SimSetup {
  return {
    id: newId(),
    name: "Bancada de demonstração",
    transport: "tcp",
    listen: "127.0.0.1:5020",
    allowLan: false,
    baudRate: 19200,
    parity: "even",
    stopBits: 1,
    slaves: structuredClone(DEMO_SLAVES),
  };
}

interface RequestLog {
  t: number;
  unitId: number;
  pdu: string;
  response: string;
}

interface Running {
  simId: string;
  label: string;
  addr?: string;
}

export function SimModule() {
  const t = useT();
  const agent = useAgent();
  const connectDemo = useConnection((s) => s.connectDemo);
  const setups = useLiveQuery(() => db.sims.orderBy("name").toArray(), [], []);
  const [id, setId] = useState<string>();
  const stored = setups.find((s) => s.id === id) ?? setups[0];
  // Optimistic local copy: nested map edits build on the latest state, not on a stale render.
  const [local, setLocal] = useState<SimSetup>();
  useEffect(() => {
    if (stored && stored.id !== local?.id) setLocal(stored);
  }, [stored, local?.id]);
  const setup = local && local.id === stored?.id ? local : stored;
  const [running, setRunning] = useState<Running[]>([]);
  const [error, setError] = useState<unknown>();
  const client = agent.status === "paired" ? agent.client : undefined;

  useEffect(() => {
    if (!client) return;
    void client.call<Running[]>("sim.list").then(setRunning).catch(() => undefined);
  }, [client]);

  if (!client) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <Notice>{t("sim.needsAgent")}</Notice>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void connectDemo()}>
            {t("palette.demo")}
          </Button>
          <Button onClick={() => useUi.getState().openModule("connection")}>{t("agent.search")}</Button>
        </div>
      </div>
    );
  }

  const up = (patch: Partial<SimSetup>) =>
    setLocal((cur) => {
      const base = cur && cur.id === setup?.id ? cur : setup;
      if (!base) return cur;
      const next = { ...base, ...patch };
      void db.sims.put(next);
      return next;
    });
  const start = async () => {
    if (!setup) return;
    setError(undefined);
    try {
      const params =
        setup.transport === "tcp"
          ? { transport: "tcp", listen: setup.listen, allowLan: setup.allowLan, slaves: setup.slaves }
          : { transport: "rtu", port: setup.port, baudRate: setup.baudRate, parity: setup.parity, stopBits: setup.stopBits, slaves: setup.slaves };
      await client.call("sim.start", params);
      setRunning(await client.call<Running[]>("sim.list"));
    } catch (e) {
      setError(e);
    }
  };
  const stop = async (simId: string) => {
    await client.call("sim.stop", { simId });
    setRunning(await client.call<Running[]>("sim.list"));
  };
  const connectTo = (addr: string) => {
    const [host, port] = addr.split(":");
    void useConnection.getState().connectAgent({ kind: "tcp", host: host!, tcpPort: Number(port) }, 1000);
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-muted">{t("sim.help")}</p>
      <div className="flex flex-wrap items-end gap-2">
        {setups.length > 0 && (
          <Field label={t("sim.setup")}>
            <Select value={setup?.id ?? ""} options={setups.map((s) => ({ value: s.id, label: s.name }))} onChange={setId} className="w-64" />
          </Field>
        )}
        <Button
          onClick={async () => {
            const s = demoSetup();
            await db.sims.add(s);
            setId(s.id);
          }}
        >
          {t("sim.newFromDemo")}
        </Button>
        {setup && (
          <Button variant="ghost" onClick={() => void db.sims.delete(setup.id)}>
            {t("common.delete")}
          </Button>
        )}
      </div>

      {running.length > 0 && (
        <Section title={t("sim.running")}>
          <ul className="flex flex-col gap-1">
            {running.map((r) => (
              <li key={r.simId} className="flex flex-wrap items-center gap-2">
                <span>● {r.label}</span>
                {r.addr && <Button onClick={() => connectTo(r.addr!)}>{t("sim.connect")}</Button>}
                <Button onClick={() => void stop(r.simId)}>{t("sim.stop")}</Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!setup ? (
        <p className="text-muted">{t("sim.empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("profile.name")}>
              <Input value={setup.name} onChange={(e) => up({ name: e.target.value })} className="w-56" />
            </Field>
            <Field label={t("sim.transport")}>
              <Select
                value={setup.transport}
                options={[
                  { value: "tcp", label: "Modbus TCP" },
                  { value: "rtu", label: "Modbus RTU" },
                ] as const}
                onChange={(transport) => up({ transport })}
              />
            </Field>
            {setup.transport === "tcp" ? (
              <>
                <Field label={t("sim.listen")}>
                  <Input value={setup.listen} onChange={(e) => up({ listen: e.target.value.trim() })} className="w-44" />
                </Field>
                <label className="flex min-h-8 items-center gap-2">
                  <input type="checkbox" className="size-4" checked={setup.allowLan} onChange={(e) => up({ allowLan: e.target.checked })} />
                  {t("sim.allowLan")}
                </label>
              </>
            ) : (
              <>
                <Field label={t("conn.port")}>
                  <Select
                    value={setup.port ?? ""}
                    options={[{ value: "", label: t("conn.port.none") }, ...agent.serialPorts.map((p) => ({ value: p.name, label: p.name }))]}
                    onChange={(port) => up({ port: port || undefined })}
                  />
                </Field>
                <Field label={t("conn.baud")}>
                  <Select value={setup.baudRate} options={[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const} onChange={(baudRate) => up({ baudRate })} />
                </Field>
                <Field label={t("conn.parity")}>
                  <Select
                    value={setup.parity}
                    options={[
                      { value: "none", label: t("conn.parity.none") },
                      { value: "even", label: t("conn.parity.even") },
                      { value: "odd", label: t("conn.parity.odd") },
                    ] as const}
                    onChange={(parity) => up({ parity })}
                  />
                </Field>
              </>
            )}
            <Button variant="primary" onClick={() => void start()} disabled={setup.transport === "rtu" && !setup.port}>
              {t("sim.start")}
            </Button>
          </div>
          {setup.transport === "tcp" && setup.allowLan && <Notice tone="warning">{t("sim.lanWarning")}</Notice>}
          {setup.transport === "rtu" && <Notice>{t("sim.rtuHint")}</Notice>}
          {error !== undefined && <ErrorBox {...describeError(t, error)} />}
          <MapEditor slaves={setup.slaves} onChange={(slaves) => up({ slaves })} />
        </>
      )}

      <RequestLog client={client} />
    </div>
  );
}

/**
 * The live request log, isolated from the rest of SimModule: a running simulator
 * can fire many sim.request notifications, and re-rendering only this table keeps
 * the (heavy) map editor from reconciling on every request.
 */
function RequestLog({ client }: { client: AgentClient }) {
  const t = useT();
  const [log, setLog] = useState<RequestLog[]>([]);
  useEffect(() => {
    return client.on("notification", (n) => {
      if (n.method !== "sim.request") return;
      const p = n.params as RequestLog & { simId: string };
      setLog((l) => [p, ...l].slice(0, 300));
    });
  }, [client]);

  return (
    <Section title={t("sim.log")}>
      {log.length === 0 ? (
        <p className="text-muted">{t("sim.log.empty")}</p>
      ) : (
        <table className="w-full text-left text-[12px]">
          <tbody>
            {log.slice(0, 100).map((r, i) => {
              const req = describePdu(r.unitId, fromHex(r.pdu), "tx");
              const res = r.response ? describePdu(r.unitId, fromHex(r.response), "rx") : undefined;
              return (
                <tr key={`${r.t}-${i}`} className="border-b border-border/40">
                  <td className="pr-2 text-muted tabular-nums">{new Date(r.t).toLocaleTimeString(undefined, { hour12: false })}</td>
                  <td className="pr-2 tabular-nums">{r.unitId}</td>
                  <td className="pr-2">{req.text}</td>
                  <td className={cx(res?.exception !== undefined ? "text-warning" : res ? "" : "text-muted")}>{res ? res.text : t("sim.log.silent")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function MapEditor({ slaves, onChange }: { slaves: SimSlaveConfig[]; onChange: (s: SimSlaveConfig[]) => void }) {
  const t = useT();
  const setSlave = (i: number, patch: Partial<SimSlaveConfig>) => onChange(slaves.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setPoint = (i: number, k: number, patch: Partial<SimPoint>) => setSlave(i, { points: slaves[i]!.points.map((p, j) => (j === k ? { ...p, ...patch } : p)) });

  return (
    <Section
      title={t("sim.map")}
      actions={
        <Button
          onClick={() =>
            onChange([...slaves, { unitId: Math.max(0, ...slaves.map((s) => s.unitId)) + 1, name: t("sim.slaveName", { n: slaves.length + 1 }), points: [] }])
          }
        >
          {t("sim.addSlave")}
        </Button>
      }
    >
      {slaves.map((s, i) => (
        <fieldset key={i} className="flex flex-col gap-2 border border-border p-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("read.unit")}>
              <Input type="number" min={1} max={247} value={s.unitId} onChange={(e) => setSlave(i, { unitId: Math.min(247, Math.max(1, e.target.valueAsNumber || 1)) })} className="w-20" />
            </Field>
            <Field label={t("profile.name")}>
              <Input value={s.name} onChange={(e) => setSlave(i, { name: e.target.value })} className="w-56" />
            </Field>
            <Button onClick={() => setSlave(i, { points: [...s.points, { table: "holding", address: s.points.length ? Math.max(...s.points.map((p) => p.address)) + 2 : 0, type: "UINT16", generator: defaultGenerator("fixed") }] })}>
              {t("sim.addPoint")}
            </Button>
            <Button variant="ghost" onClick={() => onChange(slaves.filter((_, j) => j !== i))}>
              {t("common.delete")}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="text-left text-[12px]">
              <thead className="text-muted">
                <tr>
                  <th className="pr-1 font-normal">{t("tag.name")}</th>
                  <th className="pr-1 font-normal">{t("read.table")}</th>
                  <th className="pr-1 font-normal">{t("tag.offset")}</th>
                  <th className="pr-1 font-normal">{t("read.type")}</th>
                  <th className="pr-1 font-normal">{t("read.order")}</th>
                  <th className="pr-1 font-normal">{t("sim.generator")}</th>
                  <th className="pr-1 font-normal">{t("sim.params")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.points.map((p, k) => (
                  <tr key={k} className="align-top">
                    <td className="py-0.5 pr-1">
                      <Input aria-label={t("tag.name")} value={p.name ?? ""} onChange={(e) => setPoint(i, k, { name: e.target.value })} className="w-40" />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Select aria-label={t("read.table")} value={p.table} options={["holding", "input", "coil", "discrete"] as Table[]} onChange={(table) => setPoint(i, k, { table })} />
                    </td>
                    <td className="py-0.5 pr-1">
                      <Input aria-label={t("tag.offset")} type="number" min={0} max={65535} value={p.address} onChange={(e) => setPoint(i, k, { address: Math.min(65535, Math.max(0, e.target.valueAsNumber || 0)) })} className="w-20" />
                    </td>
                    <td className="py-0.5 pr-1">
                      {p.table === "holding" || p.table === "input" ? (
                        <Select aria-label={t("read.type")} value={p.type ?? "UINT16"} options={DATA_TYPES as readonly DataType[]} onChange={(type) => setPoint(i, k, { type })} />
                      ) : (
                        <span className="text-muted">BIT</span>
                      )}
                    </td>
                    <td className="py-0.5 pr-1">
                      {(p.table === "holding" || p.table === "input") && p.type !== "STRING" && (
                        <Select aria-label={t("read.order")} value={p.order ?? "ABCD"} options={BYTE_ORDERS as readonly ByteOrder[]} onChange={(order) => setPoint(i, k, { order })} />
                      )}
                    </td>
                    <td className="py-0.5 pr-1">
                      {p.type === "STRING" ? (
                        <Input aria-label={t("sim.text")} value={p.text ?? ""} onChange={(e) => setPoint(i, k, { text: e.target.value })} className="w-40" />
                      ) : (
                        <Select
                          aria-label={t("sim.generator")}
                          value={p.generator.kind}
                          options={GENERATORS.map((g) => ({ value: g, label: t(`sim.gen.${g}`) }))}
                          onChange={(kind) => setPoint(i, k, { generator: defaultGenerator(kind) })}
                        />
                      )}
                    </td>
                    <td className="py-0.5 pr-1">{p.type !== "STRING" && <GeneratorParams g={p.generator} onChange={(generator) => setPoint(i, k, { generator })} />}</td>
                    <td className="py-0.5">
                      <Button variant="ghost" aria-label={t("common.delete")} onClick={() => setSlave(i, { points: s.points.filter((_, j) => j !== k) })}>
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
      ))}
    </Section>
  );
}

function GeneratorParams({ g, onChange }: { g: Generator; onChange: (g: Generator) => void }) {
  const t = useT();
  const num = (key: string, label: string) => (
    <label key={key} className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <Input
        aria-label={label}
        type="number"
        step="any"
        value={(g as unknown as Record<string, number>)[key] ?? 0}
        onChange={(e) => onChange({ ...g, [key]: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0 } as Generator)}
        className="w-20"
      />
    </label>
  );
  const fields: Record<Generator["kind"], [string, string][]> = {
    fixed: [["value", t("sim.p.value")]],
    ramp: [["min", t("sim.p.min")], ["max", t("sim.p.max")], ["periodMs", t("sim.p.period")]],
    sine: [["offset", t("sim.p.offset")], ["amplitude", t("sim.p.amplitude")], ["periodMs", t("sim.p.period")]],
    random: [["min", t("sim.p.min")], ["max", t("sim.p.max")]],
    counter: [["step", t("sim.p.step")], ["intervalMs", t("sim.p.interval")]],
  };
  return <div className="flex flex-wrap gap-2">{fields[g.kind].map(([k, l]) => num(k, l))}</div>;
}
