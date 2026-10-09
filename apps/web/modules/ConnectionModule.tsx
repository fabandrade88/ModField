"use client";
import { DEMO_SLAVES, getSerial } from "@modfield/transport";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Field, Input, Notice, Section, Select, StateTag, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { describeError } from "@/lib/errors";
import { useConnection } from "@/store/connection";
import { useUi, type ConnTab } from "@/store/ui";

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

export function ConnectionModule() {
  const t = useT();
  const tab = useUi((s) => s.connTab);
  const setUi = useUi((s) => s.set);
  const c = useConnection();
  const connected = c.state === "connected" || c.state === "connecting";
  const err = c.error ? describeError(t, c.error, { timeout: c.timeoutMs }) : undefined;

  const tabs: [ConnTab, string][] = [
    ["rtu", t("conn.tab.rtu")],
    ["tcp", t("conn.tab.tcp")],
    ["demo", t("conn.tab.demo")],
  ];

  return (
    <div className="flex flex-col gap-4 p-3">
      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setUi({ connTab: id })}
            className={cx(
              "-mb-px min-h-8 border-b-2 px-3",
              tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <StateTag state={c.state} />
        {c.label && <span className="text-muted">{c.label}</span>}
      </div>
      {err && <ErrorBox {...err} />}

      {tab === "rtu" && <RtuTab connected={connected} />}
      {tab === "tcp" && <Notice>{t("conn.tcp.needsAgent")}</Notice>}
      {tab === "demo" && (
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
                      {s.points.map((p) => `${p.table} ${p.address}${p.type ? ` ${p.type}${p.order && p.order !== "ABCD" ? ` ${p.order}` : ""}` : ""}`).join(" · ")}
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
              <Button variant="primary" onClick={() => void c.connectDemo()} shortcut="Ctrl+Enter">
                {t("conn.connect")}
              </Button>
            )}
          </div>
        </div>
      )}

      {c.stats && <Counters />}
    </div>
  );
}

function RtuTab({ connected }: { connected: boolean }) {
  const t = useT();
  const c = useConnection();
  // Web Serial exists only in the browser; render the notice after mount to avoid a hydration mismatch.
  const [hasSerial, setHasSerial] = useState<boolean | undefined>(undefined);
  useEffect(() => setHasSerial(Boolean(getSerial())), []);
  if (hasSerial === false) return <Notice>{t("conn.noWebSerial")}</Notice>;

  const s = c.serial;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("conn.port")} hint={t("conn.port.help")}>
        <div className="flex items-center gap-2">
          <Button onClick={() => void c.choosePort()} disabled={connected}>
            {t("conn.port.choose")}
          </Button>
          <span className={c.portLabel ? "" : "text-muted"}>{c.portLabel ?? t("conn.port.none")}</span>
        </div>
      </Field>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        <Field label={t("conn.baud")}>
          <Select value={s.baudRate} options={BAUDS} onChange={(baudRate) => c.setSerial({ baudRate })} disabled={connected} />
        </Field>
        <Field label={t("conn.dataBits")}>
          <Select value={s.dataBits} options={[8, 7] as const} onChange={(dataBits) => c.setSerial({ dataBits })} disabled={connected} />
        </Field>
        <Field label={t("conn.parity")}>
          <Select
            value={s.parity}
            options={[
              { value: "none", label: t("conn.parity.none") },
              { value: "even", label: t("conn.parity.even") },
              { value: "odd", label: t("conn.parity.odd") },
            ] as const}
            onChange={(parity) => c.setSerial({ parity })}
            disabled={connected}
          />
        </Field>
        <Field label={t("conn.stopBits")}>
          <Select value={s.stopBits} options={[1, 2] as const} onChange={(stopBits) => c.setSerial({ stopBits })} disabled={connected} />
        </Field>
        <Field label={t("conn.timeout")}>
          <Input
            type="number"
            min={20}
            max={10000}
            step={10}
            value={c.timeoutMs}
            onChange={(e) => c.setTimeoutMs(clamp(e.target.valueAsNumber, 20, 10000, 1000))}
          />
        </Field>
        <Field label={t("conn.delay")}>
          <Input
            type="number"
            min={0}
            max={1000}
            value={s.interRequestDelayMs}
            onChange={(e) => c.setSerial({ interRequestDelayMs: clamp(e.target.valueAsNumber, 0, 1000, 5) })}
            disabled={connected}
          />
        </Field>
      </div>
      <div>
        {connected && c.transport?.kind === "webserial" ? (
          <Button onClick={() => void c.disconnect()} shortcut="Ctrl+Enter">
            {t("conn.disconnect")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void c.connectSerial()} shortcut="Ctrl+Enter">
            {t("conn.connect")}
          </Button>
        )}
      </div>
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

function clamp(v: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
