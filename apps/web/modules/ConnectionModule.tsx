"use client";
import { DEMO_SLAVES, getSerial } from "@modfield/transport";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorBox, Field, HelpTip, Input, Notice, Section, Select, StateTag, Tabs, cx, useTransportLabel } from "@/components/controls";
import { useT } from "@/components/i18n";
import { db, newId, type Equipment, type Profile } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { patchProfile, updateProfile, useEquipment, useProfile, useProfiles } from "@/lib/hooks";
import { blankProfile } from "@/lib/seed";
import { useAgent } from "@/store/agent";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";
import { AgentSection } from "./connection/AgentSection";

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export function ConnectionModule() {
  const t = useT();
  const tab = useUi((s) => s.connTab);
  const setUi = useUi((s) => s.set);
  const profile = useProfile();
  const c = useConnection();
  const label = useTransportLabel(c.transport, c.label);
  const connected = c.state === "connected" || c.state === "connecting";
  const err = c.error ? describeError(t, c.error, { timeout: c.timeoutMs }) : undefined;

  return (
    <div className="flex flex-col gap-4 p-3">
      <ProfileBar />
      <AgentSection />
      <Tabs
        value={tab}
        onChange={(connTab) => setUi({ connTab })}
        tabs={[
          ["rtu", t("conn.tab.rtu")],
          ["tcp", t("conn.tab.tcp")],
          ["demo", t("conn.tab.demo")],
        ]}
      />

      <div className="flex items-center gap-3">
        <StateTag state={c.state} />
        {label && <span className="text-muted">{label}</span>}
      </div>
      {err && <ErrorBox {...err} />}
      {c.portBusy && <Notice tone="warning">{t("conn.portBusy")}</Notice>}

      {profile && tab === "rtu" && <RtuTab profile={profile} connected={connected} />}
      {profile && tab === "tcp" && <TcpTab profile={profile} connected={connected} />}
      {tab === "demo" && <DemoTab connected={connected} />}

      {profile && <CommonSettings profile={profile} />}
      {c.stats && <Counters />}
      {profile && <EquipmentSection profile={profile} />}
    </div>
  );
}

function ProfileBar() {
  const t = useT();
  const profiles = useProfiles();
  const profileId = useUi((s) => s.profileId);
  const setUi = useUi((s) => s.set);
  const [renaming, setRenaming] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = profiles.find((p) => p.id === profileId);

  const create = async () => {
    const p = blankProfile(t("profile.new.name", { n: profiles.length + 1 }));
    await db.profiles.add(p);
    setUi({ profileId: p.id });
    setRenaming(p.name);
  };

  const remove = async () => {
    if (!current || profiles.length < 2) return;
    await db.transaction("rw", db.profiles, db.tags, db.equipment, async () => {
      await db.tags.where("profileId").equals(current.id).delete();
      await db.equipment.where("profileId").equals(current.id).delete();
      await db.profiles.delete(current.id);
    });
    setUi({ profileId: profiles.find((p) => p.id !== current.id)!.id });
    setConfirmDelete(false);
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      {renaming !== undefined && current ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming.trim()) updateProfile(current.id, { name: renaming.trim() });
            setRenaming(undefined);
          }}
        >
          <Field label={t("profile.name")}>
            <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} className="w-64" />
          </Field>
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </form>
      ) : (
        <Field label={t("profile.label")}>
          <Select
            value={profileId}
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(id) => setUi({ profileId: id })}
            className="w-64"
          />
        </Field>
      )}
      <Button onClick={() => void create()}>{t("profile.new")}</Button>
      <Button onClick={() => setRenaming(current?.name ?? "")} disabled={!current}>
        {t("profile.rename")}
      </Button>
      <Button onClick={() => setConfirmDelete(true)} disabled={profiles.length < 2}>
        {t("profile.delete")}
      </Button>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("profile.delete.title", { name: current?.name ?? "" })}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={() => void remove()}>
              {t("profile.delete")}
            </Button>
          </>
        }
      >
        {t("profile.delete.body")}
      </Dialog>
    </div>
  );
}

function RtuTab({ profile, connected }: { profile: Profile; connected: boolean }) {
  const t = useT();
  const c = useConnection();
  const agent = useAgent();
  // Web Serial exists only in the browser; render the notice after mount to avoid a hydration mismatch.
  const [hasSerial, setHasSerial] = useState<boolean | undefined>(undefined);
  useEffect(() => setHasSerial(Boolean(getSerial())), []);
  const paired = agent.status === "paired";
  const via = paired && (profile.rtuVia === "agent" || hasSerial === false) ? "agent" : "browser";
  if (hasSerial === false && !paired) return <Notice>{t("conn.noWebSerial")}</Notice>;

  const s = profile.serial;
  const setSerial = (patch: Partial<Profile["serial"]>) => patchProfile(profile.id, (p) => Object.assign(p.serial, patch));
  const connect = () =>
    via === "agent"
      ? profile.agentPort && void c.connectAgent({ kind: "rtu", port: profile.agentPort, ...s }, profile.timeoutMs)
      : void c.connectSerial(s, profile.timeoutMs);
  const connectedHere = connected && c.transport?.kind === (via === "agent" ? "agent" : "webserial");
  return (
    <div className="flex flex-col gap-3">
      {paired && (
        <div role="radiogroup" aria-label={t("conn.via")} className="flex flex-wrap gap-4">
          {(["browser", "agent"] as const).map((v) => (
            <label key={v} className="flex min-h-8 items-center gap-2">
              <input
                type="radio"
                name="rtu-via"
                className="size-4"
                checked={via === v}
                disabled={connected || (v === "browser" && hasSerial === false)}
                onChange={() => updateProfile(profile.id, { rtuVia: v })}
              />
              {t(v === "agent" ? "conn.via.agent" : "conn.via.browser")}
            </label>
          ))}
        </div>
      )}
      {via === "agent" ? (
        <Field label={t("conn.port")} hint={t("conn.agentPort.help")}>
          <div className="flex items-center gap-2">
            <Select
              value={profile.agentPort ?? ""}
              options={[
                { value: "", label: t("conn.port.none") },
                ...agent.serialPorts.map((p) => ({
                  value: p.name,
                  label: [p.name, p.product, p.vid ? `${p.vid.toUpperCase()}:${p.pid?.toUpperCase()}` : ""].filter(Boolean).join(" · "),
                })),
              ]}
              onChange={(agentPort) => updateProfile(profile.id, { agentPort: agentPort || undefined })}
              disabled={connected}
              className="min-w-64"
            />
            <Button onClick={() => void agent.refreshPorts()} disabled={connected}>
              {t("conn.refreshPorts")}
            </Button>
          </div>
        </Field>
      ) : (
        <Field label={t("conn.port")} hint={t("conn.port.help")}>
          <div className="flex items-center gap-2">
            <Button onClick={() => void c.choosePort()} disabled={connected}>
              {t("conn.port.choose")}
            </Button>
            <span className={c.portLabel ? "" : "text-muted"}>{c.portLabel ?? t("conn.port.none")}</span>
          </div>
        </Field>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        <Field label={t("conn.baud")}>
          <Select value={s.baudRate} options={BAUDS} onChange={(baudRate) => setSerial({ baudRate })} disabled={connected} />
        </Field>
        <Field label={t("conn.dataBits")}>
          <Select value={s.dataBits} options={[8, 7] as const} onChange={(dataBits) => setSerial({ dataBits })} disabled={connected} />
        </Field>
        <Field label={t("conn.parity")} help={<HelpTip tip="tip.parity" doc="guides/baud-rate" />}>
          <Select
            value={s.parity}
            options={[
              { value: "none", label: t("conn.parity.none") },
              { value: "even", label: t("conn.parity.even") },
              { value: "odd", label: t("conn.parity.odd") },
            ] as const}
            onChange={(parity) => setSerial({ parity })}
            disabled={connected}
          />
        </Field>
        <Field label={t("conn.stopBits")}>
          <Select value={s.stopBits} options={[1, 2] as const} onChange={(stopBits) => setSerial({ stopBits })} disabled={connected} />
        </Field>
        <Field label={t("conn.delay")} help={<HelpTip tip="tip.delay" doc="troubleshooting#timeout" />}>
          <Input
            type="number"
            min={0}
            max={1000}
            value={s.interRequestDelayMs}
            onChange={(e) => setSerial({ interRequestDelayMs: clamp(e.target.valueAsNumber, 0, 1000, 5) })}
            disabled={connected}
          />
        </Field>
      </div>
      <div>
        {connectedHere ? (
          <Button onClick={() => void c.disconnect()} shortcut="Ctrl+Enter">
            {t("conn.disconnect")}
          </Button>
        ) : (
          <Button variant="primary" onClick={connect} shortcut="Ctrl+Enter" disabled={c.portBusy || (via === "agent" && !profile.agentPort)}>
            {t("conn.connect")}
          </Button>
        )}
      </div>
    </div>
  );
}

function TcpTab({ profile, connected }: { profile: Profile; connected: boolean }) {
  const t = useT();
  const c = useConnection();
  const agent = useAgent();
  if (agent.status !== "paired") return <Notice>{t("conn.tcp.needsAgent")}</Notice>;
  const tcp = profile.tcp;
  const connect = () => void c.connectAgent({ kind: "tcp", host: tcp.host.trim(), tcpPort: tcp.port }, profile.timeoutMs);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("conn.tcp.host")}>
          <Input value={tcp.host} onChange={(e) => patchProfile(profile.id, (p) => void (p.tcp.host = e.target.value))} disabled={connected} className="w-48" />
        </Field>
        <Field label={t("conn.tcp.port")}>
          <Input
            type="number"
            min={1}
            max={65535}
            value={tcp.port}
            onChange={(e) => {
              const port = clamp(e.target.valueAsNumber, 1, 65535, 502);
              patchProfile(profile.id, (p) => void (p.tcp.port = port));
            }}
            disabled={connected}
            className="w-24"
          />
        </Field>
      </div>
      <p className="text-[12px] text-muted">{t("conn.tcp.unitHint")}</p>
      <div>
        {connected && c.transport?.kind === "agent" && c.last?.agent?.kind === "tcp" ? (
          <Button onClick={() => void c.disconnect()} shortcut="Ctrl+Enter">
            {t("conn.disconnect")}
          </Button>
        ) : (
          <Button type="submit" variant="primary" shortcut="Ctrl+Enter" disabled={!tcp.host.trim()}>
            {t("conn.connect")}
          </Button>
        )}
      </div>
    </form>
  );
}

function DemoTab({ connected }: { connected: boolean }) {
  const t = useT();
  const c = useConnection();
  const profile = useProfile();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{t("conn.demo.desc")}</p>
      <Section title={t("conn.demo.slaves")}>
        <table className="w-full text-left">
          <tbody>
            {DEMO_SLAVES.map((s) => (
              <tr key={s.unitId} className="border-b border-border/50">
                <td className="w-12 py-1 pr-2 tabular-nums">{s.unitId}</td>
                <td className="py-1">{s.name}</td>
                <td className="py-1 text-muted">
                  {s.points
                    .map((p) => `${p.table} ${p.address}${p.type ? ` ${p.type}${p.order && p.order !== "ABCD" ? ` ${p.order}` : ""}` : ""}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[12px] text-muted">{t("conn.demo.unknown")}</p>
      </Section>
      <div>
        {connected && c.transport?.kind === "mock" ? (
          <Button onClick={() => void c.disconnect()} shortcut="Ctrl+Enter">
            {t("conn.disconnect")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void c.connectDemo(profile?.timeoutMs)} shortcut="Ctrl+Enter" disabled={c.portBusy}>
            {t("conn.connect")}
          </Button>
        )}
      </div>
    </div>
  );
}

function CommonSettings({ profile }: { profile: Profile }) {
  const t = useT();
  const setTimeoutMs = useConnection((s) => s.setTimeoutMs);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("conn.timeout")} help={<HelpTip tip="tip.timeout" doc="troubleshooting#timeout" />}>
        <Input
          type="number"
          min={20}
          max={10000}
          step={10}
          value={profile.timeoutMs}
          onChange={(e) => {
            const v = clamp(e.target.valueAsNumber, 20, 10000, 1000);
            updateProfile(profile.id, { timeoutMs: v });
            setTimeoutMs(v);
          }}
          className="w-32"
        />
      </Field>
      <label className="flex min-h-8 items-center gap-2">
        <input
          type="checkbox"
          name="forceMultipleWrite"
          className="size-4"
          checked={profile.forceMultipleWrite}
          onChange={(e) => updateProfile(profile.id, { forceMultipleWrite: e.target.checked })}
        />
        {t("conn.forceFc16")}
      </label>
    </div>
  );
}

function Counters() {
  const t = useT();
  const stats = useConnection((s) => s.stats);
  if (!stats) return null;
  const items: [string, number | string, string?][] = [
    [t("conn.requests"), stats.requests],
    [t("status.timeouts"), stats.timeouts, stats.timeouts ? "text-comm" : undefined],
    [t("status.crc"), stats.crcErrors, stats.crcErrors ? "text-comm" : undefined],
    [t("status.exceptions"), stats.exceptions, stats.exceptions ? "text-warning" : undefined],
    ["RTT", stats.lastRttMs === undefined ? "—" : `${stats.lastRttMs.toFixed(0)} ms`],
  ];
  return (
    <Section title={t("conn.counters")}>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
        {items.map(([label, value, color]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-[12px] text-muted">{label}</dt>
            <dd className={cx("text-[15px] tabular-nums", color)}>{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function EquipmentSection({ profile }: { profile: Profile }) {
  const t = useT();
  const equipment = useEquipment();
  const client = useConnection((s) => s.client);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<{ id: string; e: unknown }>();

  const add = () =>
    db.equipment.add({
      id: newId(),
      profileId: profile.id,
      unitId: Math.max(0, ...equipment.map((e) => e.unitId)) + 1,
      manufacturer: "",
      model: "",
      serialNumber: "",
      tag: "",
      firmware: "",
    });

  const identify = async (eq: Equipment) => {
    if (!client) return;
    setBusy(eq.id);
    setError(undefined);
    try {
      const o = await client.readDeviceId(eq.unitId);
      await db.equipment.update(eq.id, {
        manufacturer: o[0] ?? eq.manufacturer,
        model: o[5] ?? o[4] ?? o[1] ?? eq.model,
        firmware: o[2] ?? eq.firmware,
      });
    } catch (e) {
      setError({ id: eq.id, e });
    } finally {
      setBusy(undefined);
    }
  };

  const cols: [keyof Equipment, string, string][] = [
    ["manufacturer", t("eq.manufacturer"), "w-32"],
    ["model", t("eq.model"), "w-28"],
    ["serialNumber", t("eq.serial"), "w-28"],
    ["tag", t("eq.tag"), "w-40"],
    ["firmware", t("eq.firmware"), "w-20"],
  ];
  const err = error && describeError(t, error.e, { unit: equipment.find((e) => e.id === error.id)?.unitId });

  return (
    <Section title={t("eq.title")} actions={<Button onClick={() => void add()}>{t("eq.add")}</Button>}>
      <p className="mb-2 text-[12px] text-muted">{t("eq.help")}</p>
      {equipment.length === 0 ? (
        <p className="text-muted">{t("eq.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-left">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="pr-2 font-normal">{t("read.unit")}</th>
                {cols.map(([k, label]) => (
                  <th key={k} className="pr-2 font-normal">
                    {label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {equipment.map((eq) => (
                <tr key={eq.id}>
                  <td className="py-0.5 pr-2">
                    <Input
                      aria-label={t("read.unit")}
                      type="number"
                      min={1}
                      max={247}
                      value={eq.unitId}
                      onChange={(e) => void db.equipment.update(eq.id, { unitId: clamp(e.target.valueAsNumber, 1, 247, 1) })}
                      className="w-16"
                    />
                  </td>
                  {cols.map(([k, label, w]) => (
                    <td key={k} className="py-0.5 pr-2">
                      <Input aria-label={label} value={String(eq[k])} onChange={(e) => void db.equipment.update(eq.id, { [k]: e.target.value })} className={w} />
                    </td>
                  ))}
                  <td className="flex gap-1 py-0.5">
                    <Button onClick={() => void identify(eq)} disabled={!client || busy !== undefined} title={t("eq.identify.hint")}>
                      {busy === eq.id ? "…" : t("eq.identify")}
                    </Button>
                    <Button variant="ghost" aria-label={t("common.delete")} onClick={() => void db.equipment.delete(eq.id)}>
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <ErrorBox {...err} />}
    </Section>
  );
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
