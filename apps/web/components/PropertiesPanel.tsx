"use client";
import { formatClassic, formatRegister } from "@modfield/protocol";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useSelection } from "@/store/selection";
import { useUi } from "@/store/ui";
import { useT } from "./i18n";

export function PropertiesPanel() {
  const t = useT();
  const open = useUi((s) => s.propsOpen);
  const set = useUi((s) => s.set);
  const tag = useSelection((s) => s.tag);
  const Icon = open ? PanelRightClose : PanelRightOpen;

  return (
    <aside
      aria-label={t("props.title")}
      className={open ? "flex w-64 shrink-0 flex-col border-l border-border bg-surface" : "flex w-9 shrink-0 flex-col border-l border-border bg-surface"}
    >
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
        <div className="p-3">
          {!tag ? (
            <p className="text-muted">{t("props.empty")}</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">{t("read.unit")}</dt>
              <dd>{tag.unitId}</dd>
              <dt className="text-muted">{t("read.address")}</dt>
              <dd>
                {tag.offset} · {formatClassic(tag.table, tag.offset)}
              </dd>
              <dt className="text-muted">{t("read.table")}</dt>
              <dd>{tag.table}</dd>
              <dt className="text-muted">{t("read.type")}</dt>
              <dd>{tag.type}</dd>
              <dt className="text-muted">{t("read.order")}</dt>
              <dd>{tag.order}</dd>
              <dt className="text-muted">{t("read.col.raw")}</dt>
              <dd className="break-all">{tag.registers.map((r) => formatRegister(r, "hex")).join(" ")}</dd>
              <dt className="text-muted">bin</dt>
              <dd className="text-[12px] break-all">{tag.registers.map((r) => formatRegister(r, "bin")).join(" | ")}</dd>
              <dt className="text-muted">{t("read.col.value")}</dt>
              <dd className="text-[15px]">{String(tag.value)}</dd>
            </dl>
          )}
        </div>
      )}
    </aside>
  );
}
