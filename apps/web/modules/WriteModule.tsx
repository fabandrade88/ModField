"use client";
import { BYTE_ORDERS, DATA_TYPES, formatClassic, formatTagValue } from "@modfield/protocol";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Field, Input, Notice, Section, Select, Tabs, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { db, type WriteRecord, type WriteResult } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { useProfile, useTags } from "@/lib/hooks";
import { executeWrite, isWritable, readCurrent, toRawValue, writeFunction, type WritePlan } from "@/lib/write";
import { useConnection } from "@/store/connection";
import { useSelection } from "@/store/selection";
import { useUi } from "@/store/ui";
import { useWrite } from "@/store/write";

export function WriteModule() {
  const t = useT();
  const client = useConnection((s) => s.client);
  const profile = useProfile();
  const tags = useTags();
  const { target, setTarget, focusNonce } = useWrite();
  const sel = useSelection((s) => s.sel);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState<string>();
  const [confirming, setConfirming] = useState<{ plan: WritePlan; raw: number | string | boolean } | undefined>();
  const valueRef = useRef<HTMLInputElement>(null);

  const writableTags = useMemo(() => tags.filter((x) => isWritable(x.table)), [tags]);

  // A tag selected in Read becomes the target (that is what W means).
  useEffect(() => {
    if (sel?.kind === "tag" && writableTags.some((x) => x.id === sel.tagId)) setTarget({ mode: "tag", tagId: sel.tagId });
  }, [sel, writableTags, setTarget]);

  useEffect(() => {
    if (focusNonce) valueRef.current?.focus();
  }, [focusNonce]);

  const plan: WritePlan | undefined = useMemo(() => {
    if (target.mode === "address") return { ...target };
    const tag = writableTags.find((x) => x.id === target.tagId) ?? writableTags[0];
    if (!tag || !isWritable(tag.table)) return undefined;
    return { ...tag, table: tag.table, tagId: tag.id, tagName: tag.name };
  }, [target, writableTags]);

  const forceMultiple = profile?.forceMultipleWrite ?? false;

  const open = () => {
    if (!plan) return;
    try {
      setConfirming({ plan, raw: toRawValue(plan, value) });
      setInvalid(undefined);
    } catch (e) {
      setInvalid(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <Tabs
        value={target.mode}
        onChange={(mode) =>
          setTarget(
            mode === "tag"
              ? { mode: "tag", tagId: writableTags[0]?.id }
              : { mode: "address", unitId: 1, table: "holding", offset: 0, type: "UINT16", order: "ABCD" },
          )
        }
        tabs={[
          ["tag", t("write.byTag")],
          ["address", t("write.byAddress")],
        ]}
      />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
      >
        {target.mode === "tag" ? (
          writableTags.length === 0 ? (
            <p className="text-muted">{t("write.noTags")}</p>
          ) : (
            <Field label={t("tag.name")}>
              <Select
                value={plan && target.tagId ? target.tagId : (writableTags[0]?.id ?? "")}
                options={writableTags.map((x) => ({ value: x.id, label: `${x.name} · ${x.unitId} · ${formatClassic(x.table, x.offset)} · ${x.type}` }))}
                onChange={(tagId) => setTarget({ mode: "tag", tagId })}
                className="max-w-md"
              />
            </Field>
          )
        ) : (
          <AddressTarget />
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label={plan?.table === "coil" ? t("write.value.coil") : t("write.value", { unit: plan?.unit ?? "" })}>
            <Input ref={valueRef} value={value} onChange={(e) => setValue(e.target.value)} className="w-48" required />
          </Field>
          <Button type="submit" variant="primary" disabled={!client || !plan || !value.trim()} shortcut="W">
            {t("write.run")}
          </Button>
          {plan && <span className="text-muted">{t("write.fc", { fc: String(writeFunction(plan, forceMultiple)).padStart(2, "0") })}</span>}
        </div>
        {invalid && <Notice tone="warning">{t("write.invalid", { detail: invalid })}</Notice>}
        {!client && <p className="text-muted">{t("read.notConnected")}</p>}
      </form>

      {confirming && profile && (
        <ConfirmWrite
          plan={confirming.plan}
          raw={confirming.raw}
          text={value}
          forceMultiple={forceMultiple}
          profileId={profile.id}
          onClose={() => setConfirming(undefined)}
        />
      )}
      {profile && <History profileId={profile.id} />}
    </div>
  );
}

function AddressTarget() {
  const t = useT();
  const { target, setTarget } = useWrite();
  if (target.mode !== "address") return null;
  const up = (p: Partial<typeof target>) => setTarget({ ...target, ...p });
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
      <Field label={t("read.unit")}>
        <Input type="number" min={1} max={247} value={target.unitId} onChange={(e) => up({ unitId: Math.min(247, Math.max(1, e.target.valueAsNumber || 1)) })} />
      </Field>
      <Field label={t("read.table")}>
        <Select
          value={target.table}
          options={[
            { value: "holding", label: t("read.table.holding") },
            { value: "coil", label: t("read.table.coil") },
          ] as const}
          onChange={(table) => up({ table })}
        />
      </Field>
      <Field label={t("tag.offset")} hint={formatClassic(target.table, target.offset)}>
        <Input type="number" min={0} max={65535} value={target.offset} onChange={(e) => up({ offset: Math.min(65535, Math.max(0, e.target.valueAsNumber || 0)) })} />
      </Field>
      {target.table === "holding" && (
        <>
          <Field label={t("read.type")}>
            <Select value={target.type} options={DATA_TYPES.filter((d) => d !== "STRING")} onChange={(type) => up({ type })} />
          </Field>
          <Field label={t("read.order")}>
            <Select value={target.order} options={BYTE_ORDERS} onChange={(order) => up({ order })} />
          </Field>
        </>
      )}
    </div>
  );
}

/** Address, current value, new value and type; Enter confirms, Esc cancels. */
function ConfirmWrite({
  plan,
  raw,
  text,
  forceMultiple,
  profileId,
  onClose,
}: {
  plan: WritePlan;
  raw: number | string | boolean;
  text: string;
  forceMultiple: boolean;
  profileId: string;
  onClose: () => void;
}) {
  const t = useT();
  const client = useConnection((s) => s.client);
  const timeoutMs = useConnection((s) => s.timeoutMs);
  const [current, setCurrent] = useState<{ value?: string; error?: unknown }>();
  const [busy, setBusy] = useState(false);
  const fc = writeFunction(plan, forceMultiple);
  const next = plan.table === "coil" ? (raw ? "1" : "0") : formatTagValue(plan, plan.type === "STRING" ? text : Number(text.replace(",", ".")));

  useEffect(() => {
    if (!client) return;
    readCurrent(client, plan).then(
      (value) => setCurrent({ value }),
      (error: unknown) => setCurrent({ error }),
    );
  }, [client, plan]);

  const confirm = async () => {
    if (!client || busy) return;
    setBusy(true);
    // One-use token minted only after the user confirms; the agent requires it (phase 3).
    const confirmToken = crypto.randomUUID();
    const { result, detail } = await executeWrite(client, plan, raw, { forceMultiple, confirmToken });
    const rec: WriteRecord = {
      t: Date.now(),
      profileId,
      unitId: plan.unitId,
      table: plan.table,
      offset: plan.offset,
      type: plan.table === "coil" ? "BIT" : plan.type,
      fc,
      tagId: plan.tagId,
      tagName: plan.tagName,
      previous: current?.value,
      next,
      result,
      detail,
    };
    await db.writes.add(rec);
    onClose();
  };

  const currentText =
    current === undefined ? t("write.reading") : current.error ? t("write.current.failed", { tag: describeError(t, current.error, { unit: plan.unitId, timeout: timeoutMs }).tag }) : current.value;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("write.confirm.title")}
      footer={
        <>
          <Button onClick={onClose} shortcut="Esc">
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="confirm-write" variant="primary" disabled={busy} shortcut="Enter" data-autofocus>
            {t("write.confirm")}
          </Button>
        </>
      }
    >
      <form
        id="confirm-write"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {plan.tagName && (
            <>
              <dt className="text-muted">{t("tag.name")}</dt>
              <dd>{plan.tagName}</dd>
            </>
          )}
          <dt className="text-muted">{t("read.unit")}</dt>
          <dd>{plan.unitId}</dd>
          <dt className="text-muted">{t("read.address")}</dt>
          <dd>
            {plan.offset} · {formatClassic(plan.table, plan.offset)}
          </dd>
          <dt className="text-muted">{t("read.type")}</dt>
          <dd>
            {plan.table === "coil" ? "BIT" : `${plan.type} ${plan.order}`} · {t("write.fc", { fc: String(fc).padStart(2, "0") })}
          </dd>
          <dt className="text-muted">{t("write.current")}</dt>
          <dd className={cx("text-[15px]", current?.error ? "text-stale" : "")}>{currentText}</dd>
          <dt className="text-muted">{t("write.next")}</dt>
          <dd className="text-[18px]">{next}</dd>
        </dl>
        {current?.error !== undefined && <p className="mt-3 text-muted">{t("write.current.failedHint")}</p>}
      </form>
    </Dialog>
  );
}

const RESULT_STYLE: Record<WriteResult, [string, string]> = {
  ok: ["", "✓"],
  exception: ["text-warning", "!"],
  unknown: ["text-comm", "?"],
  error: ["text-comm", "✕"],
};

function History({ profileId }: { profileId: string }) {
  const t = useT();
  const client = useConnection((s) => s.client);
  const records = useLiveQuery(() => db.writes.where("profileId").equals(profileId).reverse().sortBy("t"), [profileId], []);
  const [checks, setChecks] = useState<Record<number, string>>({});

  const check = async (r: WriteRecord) => {
    if (!client || r.id === undefined) return;
    try {
      const tag = r.tagId ? await db.tags.get(r.tagId) : undefined;
      const plan: WritePlan =
        tag && isWritable(tag.table)
          ? { ...tag, table: tag.table }
          : { unitId: r.unitId, table: r.table, offset: r.offset, type: r.type === "BIT" ? "UINT16" : (r.type as WritePlan["type"]), order: "ABCD" };
      const value = await readCurrent(client, plan);
      setChecks((c) => ({ ...c, [r.id!]: value }));
    } catch (e) {
      setChecks((c) => ({ ...c, [r.id!]: describeError(t, e).tag }));
    }
  };

  return (
    <Section title={t("write.history")}>
      {records.length === 0 ? (
        <p className="text-muted">{t("write.history.empty")}</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="pr-3 font-normal">{t("traffic.time")}</th>
              <th className="pr-3 font-normal">{t("read.unit")}</th>
              <th className="pr-3 font-normal">{t("read.address")}</th>
              <th className="pr-3 font-normal">{t("write.previous")}</th>
              <th className="pr-3 font-normal">{t("write.next")}</th>
              <th className="font-normal">{t("write.result")}</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 100).map((r) => {
              const [color, sym] = RESULT_STYLE[r.result];
              return (
                <tr key={r.id} className="h-8 border-b border-border/50">
                  <td className="pr-3 text-muted tabular-nums">{new Date(r.t).toLocaleTimeString(undefined, { hour12: false })}</td>
                  <td className="pr-3">{r.unitId}</td>
                  <td className="pr-3">
                    {r.tagName ? `${r.tagName} · ` : ""}
                    {formatClassic(r.table, r.offset)}
                  </td>
                  <td className="pr-3 text-muted">{r.previous ?? "—"}</td>
                  <td className="pr-3">{r.next}</td>
                  <td className={color}>
                    {sym} {t(`write.result.${r.result}`)}
                    {r.detail ? ` (${r.detail})` : ""}
                    {r.result === "unknown" && (
                      <span className="ml-2 inline-flex items-center gap-2">
                        <Button onClick={() => void check(r)} disabled={!client}>
                          {t("write.check")}
                        </Button>
                        {r.id !== undefined && checks[r.id] !== undefined && <span className="text-fg">= {checks[r.id]}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function openWriteFromShortcut(): void {
  const ui = useUi.getState();
  ui.openModule("write");
  useWrite.getState().requestFocus();
}

