"use client";
import { useEffect, useRef } from "react";
import { useUi } from "@/store/ui";
import { Button, Kbd } from "./controls";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n";

const SHORTCUTS: [string, Key][] = [
  ["1 – 8", "help.k.modules"],
  ["[  ]", "help.k.panes"],
  ["Ctrl+Enter", "help.k.connect"],
  ["R", "help.k.read"],
  ["P", "help.k.cycle"],
  ["?", "help.k.help"],
];

export function HelpOverlay() {
  const t = useT();
  const set = useUi((s) => s.set);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-bg/80 p-4" onClick={() => set({ helpOpen: false })}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby="help-title"
        className="w-full max-w-md border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="help-title" className="border-b border-border px-4 py-2">
          {t("help.title")}
        </h2>
        <table className="m-4 w-[calc(100%-2rem)]">
          <tbody>
            {SHORTCUTS.map(([k, label]) => (
              <tr key={k} className="h-8">
                <td className="w-32 pr-4">
                  <Kbd>{k}</Kbd>
                </td>
                <td>{t(label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 pb-3 text-muted">{t("help.k.note")}</p>
        <div className="flex justify-end border-t border-border px-4 py-2">
          <Button ref={close} onClick={() => set({ helpOpen: false })}>
            {t("help.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
