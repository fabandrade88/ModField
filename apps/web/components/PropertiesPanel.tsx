"use client";
import { BYTE_ORDERS, DATA_TYPES, formatClassic, formatRegister, isBitTable, type TagDef } from "@modfield/protocol";
import { useLiveQuery } from "dexie-react-hooks";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { db, newId, type TagRow } from "@/lib/db";
import { useTags } from "@/lib/hooks";
import { usePolling } from "@/store/polling";
import { useSelection, type BlockSelection } from "@/store/selection";
import { useUi } from "@/store/ui";
import { Button, Field, Input, Select } from "./controls";
import { useT } from "./i18n";

export function PropertiesPanel() {
  const t = useT();
  const open = useUi((s) => s.propsOpen);
  const set = useUi((s) => s.set);
  const sel = useSelection((s) => s.sel);
  const Icon = open ? PanelRightClose : PanelRightOpen;

  return (
    <aside aria-label={t("props.title")} className={`flex shrink-0 flex-col border-l border-border bg-surface ${open ? "w-72" : "w-9"}`}>
      <div className="flex h-8 items-center justify-between border-b border-border px-2">
        {open && <span className="text-[12px] tracking-wide text-muted uppercase">{t("props.title")}</span>}
        <button
          type="button"
          onClick={() => set({ propsOpen: !open })}
          aria-label={t("props.toggle")}
          aria-expanded={open}
          className="flex size-8 items-center justify-center text-muted hover:text-fg"
        >
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!sel ? (
            <p className="text-muted">{t("props.empty")}</p>
          ) : sel.kind === "tag" ? (
            <TagEditor tagId={sel.tagId} />
          ) : (
            <BlockProps sel={sel} />
          )}
        </div>
      )}
    </aside>
  );
}

function TagEditor({ tagId }: { tagId: string }) {
  const t = useT();
  const tag = useLiveQuery(() => db.tags.get(tagId), [tagId]);
  const sample = usePolling((s) => s.latest[tagId]);
  const select = useSelection((s) => s.select);
  if (!tag) return <p className="text-muted">{t("props.empty")}</p>;
  const up = (patch: Partial<TagRow>) => void db.tags.update(tag.id, patch);
  const bits = isBitTable(tag.table);
  const num = (v: number, fb: number) => (Number.isFinite(v) ? v : fb);

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
      <Field label={t("tag.name")}>
        <Input value={tag.name} onChange={(e) => up({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("read.unit")}>
          <Input type="number" min={1} max={247} value={tag.unitId} onChange={(e) => up({ unitId: Math.min(247, Math.max(1, num(e.target.valueAsNumber, 1))) })} />
        </Field>
        <Field label={t("read.table")}>
          <Select
            value={tag.table}
            options={[
              { value: "holding", label: "holding" },
              { value: "input", label: "input" },
              { value: "coil", label: "coil" },
              { value: "discrete", label: "discrete" },
            ] as const}
            onChange={(table) => up({ table })}
          />
        </Field>
        <Field label={t("tag.offset")} hint={formatClassic(tag.table, tag.offset)}>
          <Input type="number" min={0} max={65535} value={tag.offset} onChange={(e) => up({ offset: Math.min(65535, Math.max(0, num(e.target.valueAsNumber, 0))) })} />
        </Field>
        {!bits && (
          <Field label={t("read.type")}>
            <Select value={tag.type} options={DATA_TYPES} onChange={(type) => up({ type })} />
          </Field>
        )}
        {!bits && tag.type !== "STRING" && (
          <Field label={t("read.order")}>
            <Select value={tag.order} options={BYTE_ORDERS} onChange={(order) => up({ order })} />
          </Field>
        )}
        {!bits && tag.type === "STRING" && (
          <Field label={t("read.chars")}>
            <Input type="number" min={1} max={240} value={tag.stringLength ?? 16} onChange={(e) => up({ stringLength: Math.max(1, num(e.target.valueAsNumber, 16)) })} />
          </Field>
        )}
        <Field label={t("tag.unit")}>
          <Input value={tag.unit ?? ""} onChange={(e) => up({ unit: e.target.value || undefined })} />
        </Field>
        <Field label={t("tag.decimals")}>
          <Input
            type="number"
            min={0}
            max={9}
            value={tag.decimals ?? ""}
            onChange={(e) => up({ decimals: Number.isFinite(e.target.valueAsNumber) ? Math.min(9, Math.max(0, e.target.valueAsNumber)) : undefined })}
          />
        </Field>
      </div>
      {!bits && tag.type !== "STRING" && <ScaleEditor tag={tag} onChange={(scale) => up({ scale })} />}
      <Field label={t("tag.description")}>
        <Input value={tag.description ?? ""} onChange={(e) => up({ description: e.target.value || undefined })} />
      </Field>
      {sample?.raw && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[12px]">
          <dt className="text-muted">{t("read.col.raw")}</dt>
          <dd className="break-all">{sample.raw.map((r) => formatRegister(r, "hex")).join(" ")}</dd>
          <dt className="text-muted">bin</dt>
          <dd className="break-all">{sample.raw.map((r) => formatRegister(r, "bin")).join(" | ")}</dd>
        </dl>
      )}
      <div className="pt-2">
        <Button
          variant="danger"
          onClick={() => {
            void db.tags.delete(tag.id);
            select(undefined);
          }}
        >
          {t("tag.delete")}
        </Button>
      </div>
    </form>
  );
}

function ScaleEditor({ tag, onChange }: { tag: TagDef; onChange: (s: TagDef["scale"]) => void }) {
  const t = useT();
  const s = tag.scale;
  const set = (k: keyof NonNullable<TagDef["scale"]>, v: number) => {
    if (!s || !Number.isFinite(v)) return;
    const next = { ...s, [k]: v };
    if (next.rawMin !== next.rawMax && next.engMin !== next.engMax) onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2 border border-border p-2">
      <label className="flex min-h-8 items-center gap-2">
        <input
          type="checkbox"
          className="size-4"
          checked={Boolean(s)}
          onChange={(e) => onChange(e.target.checked ? { rawMin: 0, rawMax: 65535, engMin: 0, engMax: 100 } : undefined)}
        />
        {t("tag.scale")}
      </label>
      {s && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("tag.rawMin")}>
            <Input type="number" value={s.rawMin} onChange={(e) => set("rawMin", e.target.valueAsNumber)} />
          </Field>
          <Field label={t("tag.rawMax")}>
            <Input type="number" value={s.rawMax} onChange={(e) => set("rawMax", e.target.valueAsNumber)} />
          </Field>
          <Field label={t("tag.engMin")}>
            <Input type="number" value={s.engMin} onChange={(e) => set("engMin", e.target.valueAsNumber)} />
          </Field>
          <Field label={t("tag.engMax")}>
            <Input type="number" value={s.engMax} onChange={(e) => set("engMax", e.target.valueAsNumber)} />
          </Field>
        </div>
      )}
    </fieldset>
  );
}

function BlockProps({ sel }: { sel: BlockSelection }) {
  const t = useT();
  const profileId = useUi((s) => s.profileId);
  const tags = useTags();
  const select = useSelection((s) => s.select);
  const saveAsTag = async () => {
    const id = newId();
    await db.tags.add({
      id,
      profileId,
      sort: tags.length,
      name: `TAG-${tags.length + 1}`,
      unitId: sel.unitId,
      table: sel.table,
      offset: sel.offset,
      type: sel.type,
      order: sel.order,
    });
    select({ kind: "tag", tagId: id });
    useUi.getState().set({ readTab: "tags" });
  };
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">{t("read.unit")}</dt>
        <dd>{sel.unitId}</dd>
        <dt className="text-muted">{t("read.address")}</dt>
        <dd>
          {sel.offset} · {formatClassic(sel.table, sel.offset)}
        </dd>
        <dt className="text-muted">{t("read.type")}</dt>
        <dd>{sel.type}</dd>
        <dt className="text-muted">{t("read.order")}</dt>
        <dd>{sel.order}</dd>
        <dt className="text-muted">{t("read.col.raw")}</dt>
        <dd className="break-all">{sel.registers.map((r) => formatRegister(r, "hex")).join(" ")}</dd>
        <dt className="text-muted">bin</dt>
        <dd className="text-[12px] break-all">{sel.registers.map((r) => formatRegister(r, "bin")).join(" | ")}</dd>
        <dt className="text-muted">{t("read.col.value")}</dt>
        <dd className="text-[15px]">{String(sel.value)}</dd>
      </dl>
      <div>
        <Button onClick={() => void saveAsTag()}>{t("tag.saveAs")}</Button>
      </div>
    </div>
  );
}
