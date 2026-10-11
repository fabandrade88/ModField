"use client";
import { BookOpen } from "lucide-react";
import { HOME, NUMBERED_MODULES, type ModuleId } from "@/lib/modules";
import { MODULE_ICONS } from "@/modules/registry";
import { useUi } from "@/store/ui";
import { cx } from "./controls";
import { useLang, useT } from "./i18n";
import { Credit } from "./Credit";
import { LangSwitch } from "./LangSwitch";

function Item({ id, n, hint }: { id: ModuleId; n?: number; hint?: string }) {
  const t = useT();
  const active = useUi((s) => s.panes[s.focused] === id);
  const open = useUi((s) => s.openModule);
  const Icon = MODULE_ICONS[id];
  return (
    <li>
      <button
        type="button"
        onClick={() => open(id)}
        title={t(`module.${id}`)}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={n ? String(n) : hint}
        className={cx(
          "flex min-h-8 w-full items-center gap-2 border-l-2 px-2 text-left",
          active ? "border-accent bg-surface-2 text-fg" : "border-transparent text-muted hover:bg-surface-2 hover:text-fg",
        )}
      >
        <span className="hidden w-3 text-[11px] tabular-nums md:inline">{n ?? hint ?? ""}</span>
        <Icon size={16} strokeWidth={1.5} aria-hidden />
        {/* Narrow screens: icons only, the name stays for screen readers and the tooltip. */}
        <span className="sr-only md:not-sr-only">{t(`module.${id}`)}</span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const t = useT();
  const lang = useLang();
  return (
    <nav aria-label={t("nav.label")} className="flex w-11 shrink-0 flex-col md:w-44 justify-between border-r border-border bg-surface">
      <div>
        <div className="flex min-h-8 items-center justify-between gap-1 border-b border-border md:pl-2">
          <span className="hidden text-[12px] tracking-wider text-muted uppercase md:inline">{t("app.name")}</span>
          <LangSwitch lang={lang} label={t("settings.language")} />
        </div>
        <ul>
          <Item id={HOME} hint="H" />
          <li className="my-1 border-t border-border" aria-hidden />
          {NUMBERED_MODULES.map((id, i) => (
            <Item key={id} id={id} n={i + 1} />
          ))}
        </ul>
      </div>
      <ul className="border-t border-border py-1">
        <Item id="settings" />
        <Item id="storage" />
        <li>
          {/* Opens beside the tool: navigating this tab would drop the serial connection. */}
          <a
            href={`/${lang}/docs/`}
            target="_blank"
            rel="noopener"
            title={t("module.docs")}
            className="flex min-h-8 w-full items-center gap-2 border-l-2 border-transparent px-2 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <span className="hidden w-3 md:inline" />
            <BookOpen size={16} strokeWidth={1.5} aria-hidden />
            <span className="sr-only md:not-sr-only">{t("module.docs")} ↗</span>
          </a>
        </li>
        <li className="hidden px-2 pt-1 md:block">
          <Credit label={t("credit.by")} />
        </li>
      </ul>
    </nav>
  );
}
