"use client";
import { FOOTER_MODULES, NUMBERED_MODULES, type ModuleId } from "@/lib/modules";
import { MODULE_ICONS } from "@/modules/registry";
import { useUi } from "@/store/ui";
import { cx } from "./controls";
import { useT } from "./i18n";

function Item({ id, n }: { id: ModuleId; n?: number }) {
  const t = useT();
  const active = useUi((s) => s.panes[s.focused] === id);
  const open = useUi((s) => s.openModule);
  const Icon = MODULE_ICONS[id];
  return (
    <li>
      <button
        type="button"
        onClick={() => open(id)}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={n ? String(n) : undefined}
        className={cx(
          "flex min-h-8 w-full items-center gap-2 border-l-2 px-2 text-left",
          active ? "border-accent bg-surface-2 text-fg" : "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        <span className="w-3 text-[11px] tabular-nums">{n ?? ""}</span>
        <Icon size={16} strokeWidth={1.5} aria-hidden />
        <span>{t(`module.${id}`)}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const t = useT();
  return (
    <nav aria-label={t("nav.label")} className="flex w-44 shrink-0 flex-col justify-between border-r border-border bg-surface">
      <div>
        <div className="flex h-8 items-center px-3 text-[12px] tracking-widest text-muted uppercase">{t("app.name")}</div>
        <ul>
          {NUMBERED_MODULES.map((id, i) => (
            <Item key={id} id={id} n={i + 1} />
          ))}
        </ul>
      </div>
      <ul className="border-t border-border py-1">
        {FOOTER_MODULES.map((id) => (
          <Item key={id} id={id} />
        ))}
      </ul>
    </nav>
  );
}
