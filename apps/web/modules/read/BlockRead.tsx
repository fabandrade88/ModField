"use client";
import {
  BYTE_ORDERS,
  DATA_TYPES,
  LIMITS,
  decodeValue,
  formatClassic,
  formatRegister,
  registerCount,
  type Table,
} from "@modfield/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ErrorBox, Field, HelpTip, Input, Notice, Select, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { registerCommand } from "@/lib/commands";
import { describeError } from "@/lib/errors";
import { useEquipment } from "@/lib/hooks";
import { useBlock } from "@/store/block";
import { useConnection } from "@/store/connection";
import { useSelection } from "@/store/selection";

interface Row {
  offset: number;
  registers: number[];
  value: number | string;
}

interface Result {
  rows: Row[];
  error: unknown;
  /** Rows come from an earlier read: the last one failed. */
  stale: boolean;
}

const BIT_TABLES: Table[] = ["coil", "discrete"];

export function BlockRead({ pane }: { pane: number }) {
  const t = useT();
  const client = useConnection((s) => s.client);
  const timeoutMs = useConnection((s) => s.timeoutMs);
  const select = useSelection((s) => s.select);
  const sel = useSelection((s) => s.sel);
  const equipment = useEquipment();
  const b = useBlock();

  const [intervalMs, setIntervalMs] = useState(1000);
  const [cycling, setCycling] = useState(false);
  const [cycleMs, setCycleMs] = useState<number>();
  const [result, setResult] = useState<Result>();
  const busy = useRef(false);

  const isBits = BIT_TABLES.includes(b.table);
  const perValue = isBits ? 1 : registerCount(b.type, b.stringLength);
  const maxQty = isBits ? LIMITS.maxReadBits : Math.max(1, Math.floor(LIMITS.maxReadRegisters / perValue));
  const offset = b.address - b.base;

  const readOnce = useCallback(async () => {
    if (!client || busy.current) return;
    busy.current = true;
    try {
      const qty = Math.min(b.quantity, maxQty);
      let rows: Row[];
      if (isBits) {
        const bits = await client.readBits(b.unitId, b.table as "coil" | "discrete", offset, qty);
        rows = bits.map((v, i) => ({ offset: offset + i, registers: [Number(v)], value: v ? 1 : 0 }));
      } else {
        const regs = await client.readRegisters(b.unitId, b.table as "holding" | "input", offset, qty * perValue);
        rows = Array.from({ length: qty }, (_, i) => {
          const slice = regs.slice(i * perValue, (i + 1) * perValue);
          return { offset: offset + i * perValue, registers: slice, value: decodeValue(slice, b.type, b.order) };
        });
      }
      setResult({ rows, error: undefined, stale: false });
    } catch (error) {
      setResult((r) => ({ rows: r?.rows ?? [], error, stale: Boolean(r?.rows.length) }));
    } finally {
      busy.current = false;
    }
  }, [client, b.quantity, maxQty, isBits, b.unitId, b.table, offset, perValue, b.type, b.order]);

  // Scheduled from the start of the previous read: delays never accumulate.
  useEffect(() => {
    if (!cycling || !client) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const started = performance.now();
      await readOnce();
      if (stop) return;
      const elapsed = performance.now() - started;
      setCycleMs(elapsed);
      timer = setTimeout(() => void tick(), Math.max(0, intervalMs - elapsed));
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [cycling, client, intervalMs, readOnce]);

  useEffect(() => {
    if (!client) setCycling(false);
  }, [client]);

  // Keep the properties panel live while the selected row is being read.
  useEffect(() => {
    if (sel?.kind !== "block" || !result || result.stale || sel.unitId !== b.unitId || sel.table !== b.table) return;
    const row = result.rows.find((r) => r.offset === sel.offset);
    if (row && row.value !== sel.value) select({ ...sel, registers: row.registers, value: row.value });
  }, [result, b.unitId, b.table, sel, select]);

  useEffect(() => registerCommand("read.now", pane, () => void readOnce()), [pane, readOnce]);
  useEffect(() => registerCommand("read.cycle", pane, () => setCycling((c) => !c)), [pane]);

  const err = result?.error ? describeError(t, result.error, { unit: b.unitId, timeout: timeoutMs }) : undefined;
  const displayAddress = (off: number) => (b.classic ? formatClassic(b.table, off) : String(off + b.base));
  const formatValue = (r: Row) => {
    if (typeof r.value === "string") return JSON.stringify(r.value);
    if (b.radix !== "dec" && r.registers.length === 1) return formatRegister(r.registers[0]!, b.radix);
    if (b.radix === "hex") return r.registers.map((x) => formatRegister(x, "hex")).join(" ");
    if (b.radix === "bin") return r.registers.map((x) => formatRegister(x, "bin")).join(" | ");
    return Number.isInteger(r.value) ? String(r.value) : r.value.toPrecision(7);
  };
  const int = (v: number, min: number, max: number, fb: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fb);

  return (
    <div className="flex h-full flex-col">
      <form
        className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 border-b border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void readOnce();
        }}
      >
        <Field label={t("read.unit")} help={<HelpTip tip="tip.unit" doc="guides/find-slave" />}>
          <Input
            type="number"
            min={1}
            max={247}
            value={b.unitId}
            list={equipment.length ? "read-unit-equipment" : undefined}
            onChange={(e) => b.setBlock({ unitId: int(e.target.valueAsNumber, 1, 247, 1) })}
          />
          {equipment.length > 0 && (
            <datalist id="read-unit-equipment">
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.unitId}>
                  {[eq.tag, eq.model, eq.manufacturer].filter(Boolean).join(" · ") || t("eq.unitList")}
                </option>
              ))}
            </datalist>
          )}
        </Field>
        <Field label={t("read.table")}>
          <Select
            value={b.table}
            options={[
              { value: "holding", label: t("read.table.holding") },
              { value: "input", label: t("read.table.input") },
              { value: "coil", label: t("read.table.coil") },
              { value: "discrete", label: t("read.table.discrete") },
            ] as const}
            onChange={(table) => b.setBlock({ table })}
          />
        </Field>
        <Field label={t("read.base")} help={<HelpTip tip="tip.base" doc="modbus-reference#addressing" />}>
          <Select
            value={b.base}
            options={[
              { value: 0, label: t("read.base.0") },
              { value: 1, label: t("read.base.1") },
            ] as const}
            onChange={(base) => b.setBlock({ base, address: Math.max(base, b.address) })}
          />
        </Field>
        <Field label={t("read.address")}>
          <Input
            type="number"
            min={b.base}
            max={0xffff + b.base}
            value={b.address}
            onChange={(e) => b.setBlock({ address: int(e.target.valueAsNumber, b.base, 0xffff + b.base, b.base) })}
          />
        </Field>
        <Field label={t("read.quantity")}>
          <Input type="number" min={1} max={maxQty} value={b.quantity} onChange={(e) => b.setBlock({ quantity: int(e.target.valueAsNumber, 1, maxQty, 1) })} />
        </Field>
        {!isBits && (
          <>
            <Field label={t("read.type")}>
              <Select value={b.type} options={DATA_TYPES} onChange={(type) => b.setBlock({ type })} />
            </Field>
            {b.type === "STRING" ? (
              <Field label={t("read.chars")}>
                <Input
                  type="number"
                  min={2}
                  max={240}
                  step={2}
                  value={b.stringLength}
                  onChange={(e) => b.setBlock({ stringLength: int(e.target.valueAsNumber, 2, 240, 16) })}
                />
              </Field>
            ) : (
              <Field label={t("read.order")} help={<HelpTip tip="tip.order" doc="modbus-reference#byte-order" />}>
                <Select value={b.order} options={BYTE_ORDERS} onChange={(order) => b.setBlock({ order })} />
              </Field>
            )}
            <Field label={t("read.radix")}>
              <Select value={b.radix} options={["dec", "hex", "bin"] as const} onChange={(radix) => b.setBlock({ radix })} />
            </Field>
          </>
        )}
        <Field label={t("read.interval")}>
          <Input type="number" min={100} max={60000} step={100} value={intervalMs} onChange={(e) => setIntervalMs(int(e.target.valueAsNumber, 100, 60000, 1000))} />
        </Field>
        <div className="col-span-full flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!client} shortcut="R">
            {t("read.now")}
          </Button>
          <Button onClick={() => setCycling((c) => !c)} disabled={!client} shortcut="P" aria-pressed={cycling}>
            {cycling ? t("read.cycle.stop") : t("read.cycle.start")}
          </Button>
          <label className="flex min-h-8 items-center gap-2 text-muted">
            <input type="checkbox" checked={b.classic} onChange={(e) => b.setBlock({ classic: e.target.checked })} className="size-4" />
            {t("read.base.classic")}
          </label>
          {cycling && cycleMs !== undefined && (
            <span className={cx("tabular-nums", cycleMs > intervalMs ? "text-warning" : "text-muted")}>
              {cycleMs > intervalMs ? "! " : ""}
              {t("status.cycle")} {cycleMs.toFixed(0)} ms
            </span>
          )}
        </div>
      </form>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
        {cycling && cycleMs !== undefined && cycleMs > intervalMs && (
          <Notice tone="warning">{t("read.cycle.real", { real: cycleMs.toFixed(0), asked: intervalMs })}</Notice>
        )}
        {err && <ErrorBox {...err} />}
        {!client ? (
          <p className="text-muted">{t("read.notConnected")}</p>
        ) : !result?.rows.length ? (
          !err && <p className="text-muted">{t("read.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-surface text-[12px] text-muted">
              <tr>
                <th className="py-1 pr-4 font-normal">{t("read.col.address")}</th>
                <th className="py-1 pr-4 font-normal">{t("read.col.raw")}</th>
                <th className="py-1 font-normal">{t("read.col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => {
                const isSelected = sel?.kind === "block" && sel.unitId === b.unitId && sel.table === b.table && sel.offset === r.offset;
                return (
                  <tr
                    key={r.offset}
                    aria-selected={isSelected}
                    onClick={() =>
                      select({
                        kind: "block",
                        unitId: b.unitId,
                        table: b.table,
                        offset: r.offset,
                        type: isBits ? "UINT16" : b.type,
                        order: b.order,
                        registers: r.registers,
                        value: r.value,
                      })
                    }
                    className={cx(
                      "h-8 cursor-default border-b border-border/50 hover:bg-surface-2",
                      isSelected && "bg-surface-2 outline-1 -outline-offset-1 outline-accent",
                    )}
                  >
                    <td className="pr-4 tabular-nums">{displayAddress(r.offset)}</td>
                    <td className="pr-4 text-muted tabular-nums">{r.registers.map((x) => (isBits ? x : formatRegister(x, "hex"))).join(" ")}</td>
                    <td className={cx("text-[15px] tabular-nums", result.stale && "text-stale")}>
                      <span key={String(r.value)} className="value-changed px-1">
                        {formatValue(r)}
                      </span>
                      {result.stale && <span title={t("read.stale")}> ?</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
