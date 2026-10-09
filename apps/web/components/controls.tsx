"use client";
import type { ConnState } from "@modfield/transport";
import { cx } from "@modfield/ui/components";
import { useT } from "./i18n";

export * from "@modfield/ui/components";

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
