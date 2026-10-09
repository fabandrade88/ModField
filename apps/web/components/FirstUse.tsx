"use client";
import { Cable, Network, PlayCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";
import { Kbd } from "./controls";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n";
import { DEMO_PROFILE_ID } from "@/lib/seed";

/** One screen, three choices, no balloon tour. */
export function FirstUse() {
  const t = useT();
  const set = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  const setPane = useUi((s) => s.setPane);
  const connectDemo = useConnection((s) => s.connectDemo);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  const options: { id: string; icon: LucideIcon; title: Key; desc: Key; run: () => void }[] = [
    {
      id: "usb",
      icon: Cable,
      title: "first.usb",
      desc: "first.usb.desc",
      run: () => {
        setPane(0, "connection");
        set({ connTab: "rtu" });
      },
    },
    {
      id: "tcp",
      icon: Network,
      title: "first.tcp",
      desc: "first.tcp.desc",
      run: () => {
        setPane(0, "connection");
        set({ connTab: "tcp" });
      },
    },
    {
      id: "demo",
      icon: PlayCircle,
      title: "first.demo",
      desc: "first.demo.desc",
      run: () => {
        setLayout(2);
        setPane(1, "traffic");
        setPane(0, "read");
        set({ connTab: "demo", profileId: DEMO_PROFILE_ID, readTab: "tags" });
        void connectDemo();
      },
    },
  ];

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-bg/95 p-4">
      <div role="dialog" aria-modal aria-labelledby="first-title" className="w-full max-w-xl border border-border bg-surface">
        <h1 id="first-title" className="border-b border-border px-4 py-3 text-[15px]">
          {t("first.title")}
        </h1>
        <ul className="flex flex-col">
          {options.map(({ id, icon: Icon, title, desc, run }, i) => (
            <li key={id} className="border-b border-border last:border-b-0">
              <button
                ref={i === 0 ? first : undefined}
                type="button"
                data-option={id}
                onClick={() => {
                  run();
                  set({ firstUseDone: true });
                }}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2"
              >
                <Icon size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span>{t(title)}</span>
                  <span className="text-muted">{t(desc)}</span>
                </span>
                <Kbd>{i + 1}</Kbd>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
