"use client";
import { formatClassic, formatTagValue, isBitTable } from "@modfield/protocol";
import { useEffect, useState } from "react";
import { Button, ErrorBox, Field, Input, Notice, cx } from "@/components/controls";
import { useT } from "@/components/i18n";
import { registerCommand } from "@/lib/commands";
import { describeError } from "@/lib/errors";
import { useTags } from "@/lib/hooks";
import { addTag } from "@/lib/tags";
import { useConnection } from "@/store/connection";
import { usePolling } from "@/store/polling";
import { useSelection } from "@/store/selection";
import { useUi } from "@/store/ui";
import { ImportDialog } from "./ImportDialog";

export function TagTable({ pane }: { pane: number }) {
  const t = useT();
  const tags = useTags();
  const client = useConnection((s) => s.client);
  const timeoutMs = useConnection((s) => s.timeoutMs);
  const profileId = useUi((s) => s.profileId);
  const p = usePolling();
  const sel = useSelection((s) => s.sel);
  const select = useSelection((s) => s.select);
  const [importing, setImporting] = useState(false);

  useEffect(() => registerCommand("read.now", pane, () => void usePolling.getState().readNow(tags)), [pane, tags]);
  useEffect(
    () =>
      registerCommand("read.cycle", pane, () => {
        const s = usePolling.getState();
        if (s.running) s.stop();
        else s.start(tags);
      }),
    [pane, tags],
  );

  useEffect(
    () => registerCommand("tag.add", pane, () => void addTag(profileId, tags).then((id) => select({ kind: "tag", tagId: id }))),
    [pane, profileId, tags, select],
  );

  // The tag list changed while polling: restart with the new plan.
  useEffect(() => {
    if (usePolling.getState().running) usePolling.getState().start(tags);
  }, [tags]);

  const slow = p.running && p.cycleMs !== undefined && p.cycleMs > p.intervalMs;
  // One error per failing slave is enough: show the first.
  const failing = tags.map((tag) => p.latest[tag.id]).find((s) => s?.quality === "bad" && s.error);
  const err = failing?.error && describeError(t, failing.error, { unit: tags.find((x) => x.id === failing.tagId)?.unitId, timeout: timeoutMs });

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
        <Button variant="primary" disabled={!client || !tags.length} onClick={() => void p.readNow(tags)} shortcut="R">
          {t("read.now")}
        </Button>
        <Button disabled={!client || !tags.length} onClick={() => (p.running ? p.stop() : p.start(tags))} shortcut="P" aria-pressed={p.running}>
          {p.running ? t("read.cycle.stop") : t("read.cycle.start")}
        </Button>
        <Field label={t("read.interval")}>
          <Input
            type="number"
            min={100}
            max={60000}
            step={100}
            value={p.intervalMs}
            onChange={(e) => p.setIntervalMs(Number.isFinite(e.target.valueAsNumber) ? Math.min(60000, Math.max(100, e.target.valueAsNumber)) : 1000)}
            className="w-28"
          />
        </Field>
        <Button onClick={() => void addTag(profileId, tags).then((id) => select({ kind: "tag", tagId: id }))} shortcut="A">
          {t("tag.add")}
        </Button>
        <Button onClick={() => setImporting(true)}>{t("tag.import")}</Button>
        {p.cycleMs !== undefined && (
          <span className={cx("ml-auto tabular-nums", slow ? "text-warning" : "text-muted")}>
            {slow ? "! " : ""}
            {t("status.cycle")} {p.cycleMs.toFixed(0)} ms · {t("read.requestsPerCycle", { n: p.requestsPerCycle ?? 0 })}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3">
        {slow && <Notice tone="warning">{t("read.cycle.real", { real: p.cycleMs!.toFixed(0), asked: p.intervalMs })}</Notice>}
        {err && <ErrorBox {...err} />}
        {!client && <p className="text-muted">{t("read.notConnected")}</p>}
        {tags.length === 0 ? (
          <p className="text-muted">{t("tag.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-surface text-[12px] text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">{t("tag.name")}</th>
                <th className="py-1 pr-3 font-normal">{t("read.unit")}</th>
                <th className="py-1 pr-3 font-normal">{t("read.address")}</th>
                <th className="py-1 pr-3 font-normal">{t("read.type")}</th>
                <th className="py-1 pr-3 font-normal">{t("read.col.value")}</th>
                <th className="py-1 font-normal">{t("tag.state")}</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => {
                const s = p.latest[tag.id];
                const stale = s?.quality === "bad";
                const selected = sel?.kind === "tag" && sel.tagId === tag.id;
                return (
                  <tr
                    key={tag.id}
                    aria-selected={selected}
                    onClick={() => select({ kind: "tag", tagId: tag.id })}
                    className={cx(
                      "h-8 cursor-default border-b border-border/50 hover:bg-surface-2",
                      selected && "bg-surface-2 outline-1 -outline-offset-1 outline-accent",
                    )}
                  >
                    <td className="pr-3">{tag.name}</td>
                    <td className="pr-3 tabular-nums">{tag.unitId}</td>
                    <td className="pr-3 whitespace-nowrap text-muted tabular-nums">{formatClassic(tag.table, tag.offset)}</td>
                    <td className="pr-3 whitespace-nowrap text-muted">{isBitTable(tag.table) ? "BIT" : `${tag.type}${tag.order !== "ABCD" && tag.type !== "STRING" ? ` ${tag.order}` : ""}`}</td>
                    <td className={cx("pr-3 text-[15px] whitespace-nowrap tabular-nums", stale && "text-stale")}>
                      <span key={String(s?.value)} className="value-changed px-1">
                        {formatTagValue(tag, s?.value)}
                      </span>
                      {stale && s?.value !== undefined && <span title={t("read.stale")}> ?</span>}
                    </td>
                    <td className={cx("text-[12px]", s?.error?.code === "MODBUS_EXCEPTION" ? "text-warning" : "text-comm")}>
                      {s?.error ? `! ${s.error.tag}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}
