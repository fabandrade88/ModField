"use client";
import { parseClassic, type Table } from "@modfield/protocol";
import { THEMES } from "@modfield/ui";
import { useMemo, useState } from "react";
import { runCommand } from "@/lib/commands";
import { NUMBERED_MODULES, FOOTER_MODULES } from "@/lib/modules";
import { openWriteFromShortcut } from "@/modules/WriteModule";
import { useBlock } from "@/store/block";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";
import { Dialog, cx } from "./controls";
import { useT } from "./i18n";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const TABLE_WORDS: Record<string, Table> = {
  holding: "holding",
  input: "input",
  coil: "coil",
  coils: "coil",
  discrete: "discrete",
};

/**
 * "ler holding 40001", "read input 30010", "ler 40001": jumps to a block
 * read of that address. Returns undefined when the text is not a read.
 */
export function parseReadCommand(text: string): { table: Table; offset: number } | undefined {
  const m = /^(?:ler|read|lesen)\s+(?:(holding|input|coils?|discrete)\s+)?(\d+)$/i.exec(text.trim());
  if (!m) return undefined;
  const word = m[1]?.toLowerCase();
  const n = m[2]!;
  if (/^\d{5,6}$/.test(n) && /^[0134]/.test(n)) {
    try {
      const c = parseClassic(n);
      return { table: word ? TABLE_WORDS[word]! : c.table, offset: c.offset };
    } catch {
      return undefined;
    }
  }
  return { table: word ? TABLE_WORDS[word]! : "holding", offset: Number(n) };
}

export function CommandPalette() {
  const t = useT();
  const open = useUi((s) => s.paletteOpen);
  const set = useUi((s) => s.set);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const close = () => {
    set({ paletteOpen: false });
    setQ("");
    setActive(0);
  };

  const commands = useMemo<Command[]>(() => {
    const ui = useUi.getState();
    const c = useConnection.getState();
    return [
      ...[...NUMBERED_MODULES, ...FOOTER_MODULES].map((m, i) => ({
        id: `open:${m}`,
        label: t("palette.open", { module: t(`module.${m}`) }),
        hint: i < NUMBERED_MODULES.length ? String(i + 1) : undefined,
        run: () => ui.openModule(m),
      })),
      { id: "connect", label: t("palette.toggle"), hint: "Ctrl+Enter", run: () => void c.toggle().then((ok) => ok || ui.openModule("connection")) },
      { id: "demo", label: t("palette.demo"), run: () => void c.connectDemo() },
      { id: "read", label: t("read.now"), hint: "R", run: () => runCommand("read.now", ui.focused) },
      { id: "cycle", label: t("help.k.cycle"), hint: "P", run: () => runCommand("read.cycle", ui.focused) },
      { id: "write", label: t("write.run"), hint: "W", run: openWriteFromShortcut },
      { id: "add-tag", label: t("tag.add"), hint: "A", run: () => runCommand("tag.add", ui.focused) },
      ...THEMES.map((th) => ({ id: `theme:${th.id}`, label: t("palette.theme", { name: th.name }), run: () => ui.set({ theme: th.id }) })),
      { id: "help", label: t("help.title"), hint: "?", run: () => ui.set({ helpOpen: true }) },
    ];
  }, [t]);

  const read = parseReadCommand(q);
  const needle = q.trim().toLowerCase();
  const list: Command[] = [
    ...(read
      ? [
          {
            id: "read-addr",
            label: t("palette.readAddr", { table: read.table, offset: read.offset }),
            run: () => {
              useBlock.getState().setBlock({ table: read.table, address: read.offset + useBlock.getState().base, quantity: 1 });
              const ui = useUi.getState();
              ui.set({ readTab: "block" });
              ui.openModule("read");
              setTimeout(() => runCommand("read.now", useUi.getState().focused), 50);
            },
          },
        ]
      : []),
    ...commands.filter((c) => !needle || c.label.toLowerCase().includes(needle)),
  ];
  const pick = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <Dialog open={open} onClose={close} title={t("palette.title")} className="max-w-xl">
      <input
        data-autofocus
        value={q}
        placeholder={t("palette.placeholder")}
        aria-label={t("palette.title")}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(list.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter") pick(list[active]);
          else return;
          e.preventDefault();
        }}
        className="min-h-8 w-full border border-border bg-surface-2 px-2"
      />
      <ul role="listbox" className="mt-2 max-h-80 overflow-auto">
        {list.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === active}>
            <button
              type="button"
              onClick={() => pick(c)}
              onMouseEnter={() => setActive(i)}
              className={cx("flex min-h-8 w-full items-center justify-between px-2 text-left", i === active && "bg-surface-2 outline-1 -outline-offset-1 outline-accent")}
            >
              <span>{c.label}</span>
              {c.hint && <span className="text-[11px] text-muted">{c.hint}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
