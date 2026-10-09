"use client";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "@/store/connection";
import { usePolling } from "@/store/polling";
import { useUi, type Layout } from "@/store/ui";
import { StateTag, cx } from "./controls";
import { useLang, useT } from "./i18n";

const LOCALES = { pt: "pt-BR", en: "en-GB", de: "de-DE" } as const;

function Seg({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("flex items-center gap-1 border-r border-border px-2 whitespace-nowrap", className)}>{children}</span>;
}

/** Bottom bar, Waybar style. */
export function StatusBar() {
  const t = useT();
  const lang = useLang();
  const { state, label, stats, transport } = useConnection();
  const layout = useUi((s) => s.layout);
  const polling = usePolling((s) => s.running);
  const cycleMs = usePolling((s) => s.cycleMs);
  const intervalMs = usePolling((s) => s.intervalMs);
  const slow = polling && cycleMs !== undefined && cycleMs > intervalMs;
  const setLayout = useUi((s) => s.setLayout);
  const setUi = useUi((s) => s.set);
  const [now, setNow] = useState<Date>();
  const [rate, setRate] = useState(0);
  const last = useRef<{ n: number; t: number }>(undefined);

  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      const s = useConnection.getState().stats;
      const n = s?.requests ?? 0;
      const tNow = performance.now();
      if (last.current && n >= last.current.n) setRate(((n - last.current.n) * 1000) / (tNow - last.current.t));
      last.current = { n, t: tNow };
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="flex h-8 shrink-0 items-stretch border-t border-border bg-surface text-[12px]">
      <Seg>
        <span className="text-muted">{t("status.agent")}</span> <span className="text-stale">? {t("status.agent.absent")}</span>
      </Seg>
      <Seg>
        <StateTag state={state} />
        {label && <span className="text-muted">{label}</span>}
      </Seg>
      {transport && <Seg>RTU</Seg>}
      <Seg>
        <span className="tabular-nums">{rate.toFixed(1)}</span> <span className="text-muted">{t("status.reqs")}</span>
      </Seg>
      <Seg className={stats?.timeouts ? "text-comm" : undefined}>
        <span className="tabular-nums">{stats?.timeouts ?? 0}</span> <span className={stats?.timeouts ? "" : "text-muted"}>{t("status.timeouts")}</span>
      </Seg>
      <Seg className={stats?.crcErrors ? "text-comm" : undefined}>
        <span className="tabular-nums">{stats?.crcErrors ?? 0}</span> <span className={stats?.crcErrors ? "" : "text-muted"}>{t("status.crc")}</span>
      </Seg>
      {polling && cycleMs !== undefined && (
        <Seg className={slow ? "text-warning" : undefined}>
          <span className={slow ? "" : "text-muted"}>{slow ? "! " : ""}{t("status.cycle")}</span>
          <span className="tabular-nums">{cycleMs.toFixed(0)} ms</span>
        </Seg>
      )}
      <Seg>
        <span className="text-muted">{t("status.log")}</span> {t("status.log.none")}
      </Seg>
      <span className="flex-1" />
      <Seg className="border-l">
        <span className="text-muted">{t("status.layout")}</span>
        {([1, 2, 4] as Layout[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLayout(l)}
            aria-pressed={layout === l}
            className={cx("min-w-8 px-1", layout === l ? "text-accent" : "text-muted hover:text-fg")}
          >
            {l}
          </button>
        ))}
      </Seg>
      <Seg>
        <button type="button" onClick={() => setUi({ helpOpen: true })} className="min-w-8 text-muted hover:text-fg" aria-keyshortcuts="?">
          ?
        </button>
      </Seg>
      <span className="flex items-center px-2 tabular-nums" suppressHydrationWarning>
        {now?.toLocaleTimeString(LOCALES[lang], { hour12: false }) ?? ""}
      </span>
    </footer>
  );
}
