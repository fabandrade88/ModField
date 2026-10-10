"use client";
import { useUi } from "@/store/ui";
import { Button, Dialog, Kbd } from "./controls";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n";

const SHORTCUTS: [string, Key][] = [
  ["H", "help.k.home"],
  ["1 – 8", "help.k.modules"],
  ["[  ]", "help.k.panes"],
  ["Ctrl+K  /", "help.k.palette"],
  ["Ctrl+Enter", "help.k.connect"],
  ["R", "help.k.read"],
  ["P", "help.k.cycle"],
  ["A", "help.k.addTag"],
  ["W", "help.k.write"],
  ["L", "help.k.logger"],
  ["M", "help.k.marker"],
  ["G", "help.k.report"],
  ["?", "help.k.help"],
];

export function HelpOverlay() {
  const t = useT();
  const set = useUi((s) => s.set);
  const close = () => set({ helpOpen: false });
  return (
    <Dialog
      open
      onClose={close}
      title={t("help.title")}
      className="max-w-md"
      footer={
        <Button data-autofocus onClick={close}>
          {t("help.close")}
        </Button>
      }
    >
      <table className="w-full">
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
      <p className="pt-3 text-muted">{t("help.k.note")}</p>
    </Dialog>
  );
}
