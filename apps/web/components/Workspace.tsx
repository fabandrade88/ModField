"use client";
import { FOOTER_MODULES, HOME, NUMBERED_MODULES } from "@/lib/modules";
import { renderModule } from "@/modules/registry";
import { useUi } from "@/store/ui";
import { cx } from "./controls";
import { useT } from "./i18n";

const GRID = { 1: "grid-cols-1 grid-rows-1", 2: "grid-cols-2 grid-rows-1", 4: "grid-cols-2 grid-rows-2" } as const;

/** Tiled panes, like Hyprland: 1, 2 or 4 panes; the focused one has the accent border. */
export function Workspace() {
  const layout = useUi((s) => s.layout);
  return (
    <main className={cx("grid min-h-0 min-w-0 flex-1 gap-2 p-2", GRID[layout])}>
      {Array.from({ length: layout }, (_, i) => (
        <Pane key={i} index={i} />
      ))}
    </main>
  );
}

function Pane({ index }: { index: number }) {
  const t = useT();
  const id = useUi((s) => s.panes[index] ?? "connection");
  const focused = useUi((s) => s.focused === index);
  const focus = useUi((s) => s.focusPane);
  const setPane = useUi((s) => s.setPane);
  const all = [HOME, ...NUMBERED_MODULES, ...FOOTER_MODULES];

  return (
    <section
      aria-label={t("pane.focus", { n: index + 1 })}
      data-focused={focused}
      onPointerDownCapture={() => focus(index)}
      onFocusCapture={() => focus(index)}
      className={cx(
        "flex min-h-0 min-w-0 flex-col border bg-surface",
        focused ? "border-accent outline-1 outline-accent" : "border-border",
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-2">
        <span className="text-[11px] text-muted tabular-nums">{index + 1}</span>
        <select
          aria-label={t("pane.module")}
          value={id}
          onChange={(e) => setPane(index, e.target.value as typeof id)}
          className="h-7 border-none bg-transparent pr-1 text-[13px] text-fg"
        >
          {all.map((m) => (
            <option key={m} value={m}>
              {t(`module.${m}`)}
            </option>
          ))}
        </select>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{renderModule(id, index)}</div>
    </section>
  );
}
