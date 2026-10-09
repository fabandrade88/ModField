"use client";
import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { ConnState } from "@modfield/transport";
import { useT } from "./i18n";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/** Every clickable control is at least 32 px tall (gloves, small screens). */
export function Button({
  variant = "default",
  className,
  shortcut,
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: "default" | "primary" | "ghost"; shortcut?: string }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex min-h-8 items-center gap-2 rounded-sm border px-3 text-[13px] whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "border-border bg-surface-2 hover:border-muted",
        variant === "primary" && "border-accent bg-surface-2 hover:bg-surface",
        variant === "ghost" && "border-transparent hover:border-border",
        className,
      )}
    >
      {children}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-xs border border-border px-1 text-[11px] text-muted">{children}</kbd>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

const inputClass = "min-h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-fg";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(inputClass, "tabular-nums", className)} />;
}

export function Select<V extends string | number>({
  value,
  options,
  onChange,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: V;
  options: readonly (V | { value: V; label: string })[];
  onChange: (v: V) => void;
}) {
  const norm = options.map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  return (
    <select
      {...rest}
      value={String(value)}
      onChange={(e) => {
        const hit = norm.find((o) => String(o.value) === e.target.value);
        if (hit) onChange(hit.value);
      }}
      className={cx(inputClass, className)}
    >
      {norm.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
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

/** The "Como resolver" link to the troubleshooting table arrives with the docs (phase 6). */
export function ErrorBox({ tag, message }: { tag: string; message: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-comm px-3 py-2">
      <span className="text-comm">! {tag}</span>
      <span>{message}</span>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="border border-border bg-surface-2 px-3 py-2">{children}</div>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-[12px] tracking-wide text-muted uppercase">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

export { cx };
