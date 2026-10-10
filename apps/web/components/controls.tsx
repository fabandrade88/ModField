"use client";
import type { ConnState, Transport } from "@modfield/transport";
import { ErrorBox as BaseErrorBox, cx } from "@modfield/ui/components";
import { useId, type ReactNode } from "react";
import type { Key } from "@/lib/i18n";
import { useLang, useT } from "./i18n";

export * from "@modfield/ui/components";

/** "Demonstração · 19200 8E1", "Agente · TCP 10.0.0.5:502", "FTDI 0403:6001 · 9600 8N1". */
export function useTransportLabel(transport: Transport | undefined, label: string): string {
  const t = useT();
  if (!transport || !label) return "";
  if (transport.kind === "mock") return `${t("conn.tab.demo")} · ${label}`;
  if (transport.kind === "agent") return `${t("conn.prefix.agent")} · ${label}`;
  return label;
}

/** Error box with the "How to fix" link to the exact troubleshooting entry (opens beside the tool). */
export function ErrorBox({ tag, message, anchor, children }: { tag: string; message: string; anchor?: string; children?: ReactNode }) {
  const t = useT();
  const lang = useLang();
  return (
    <BaseErrorBox tag={tag} message={message}>
      {anchor && (
        <a href={`/${lang}/docs/troubleshooting/#${anchor}`} target="_blank" rel="noopener" className="text-[12px] text-accent underline">
          {t("error.howto")} ↗
        </a>
      )}
      {children}
    </BaseErrorBox>
  );
}

/** "?" next to a technical field: two lines and a link to the full page. */
export function HelpTip({ tip, doc }: { tip: Key; doc: string }) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={t("tip.more")}
        className="inline-flex size-5 items-center justify-center border border-border text-[11px] text-muted hover:text-fg"
      >
        ?
      </button>
      <div id={id} popover="auto" className="m-auto max-w-sm border border-border bg-surface p-3 text-[13px] text-fg">
        <p>{t(tip)}</p>
        <a href={`/${lang}/docs/${doc}`} target="_blank" rel="noopener" className="mt-2 inline-block text-[12px] text-accent underline">
          {t("tip.more")} ↗
        </a>
      </div>
    </>
  );
}

/** Never color alone: every state carries text and a symbol. */
export function StateTag({ state }: { state: ConnState }) {
  const t = useT();
  const style: Record<ConnState, [string, string]> = {
    disconnected: ["text-muted", "○"],
    connecting: ["text-warning", "…"],
    connected: ["text-fg", "●"],
    error: ["text-comm", "✕"],
  };
  const [color, symbol] = style[state];
  return (
    <span className={cx("whitespace-nowrap", color)} data-state={state}>
      {symbol} {t(`state.${state}`)}
    </span>
  );
}
