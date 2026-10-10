"use client";
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode, type SelectHTMLAttributes } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Every clickable control is at least 32 px tall (gloves, small screens). */
export function Button({
  variant = "default",
  className,
  shortcut,
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: "default" | "primary" | "ghost" | "danger"; shortcut?: string }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex min-h-8 items-center gap-2 rounded-sm border px-3 text-[13px] whitespace-nowrap",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "border-border bg-surface-2 hover:border-muted",
        variant === "primary" && "border-accent bg-surface-2 hover:bg-surface",
        variant === "danger" && "border-critical bg-surface-2 text-critical hover:bg-surface",
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

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="text-[12px] text-muted">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass = "min-h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-fg";

/**
 * Text input that keeps what is being typed while it has focus. Values that
 * come back asynchronously (IndexedDB) would otherwise reset the field between
 * keystrokes and drop characters. External changes apply when it is not focused.
 */
export function Input({ className, value, onChange, onFocus, onBlur, ...rest }: ComponentProps<"input">) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  return (
    <input
      {...rest}
      value={value === undefined ? undefined : (local ?? "")}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setLocal(value);
        onBlur?.(e);
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange?.(e);
      }}
      className={cx(inputClass, "tabular-nums", className)}
    />
  );
}

/** Textarea with the same focus-buffering as Input. */
export function TextArea({ className, value, onChange, onFocus, onBlur, ...rest }: ComponentProps<"textarea">) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  return (
    <textarea
      {...rest}
      value={local ?? ""}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setLocal(value);
        onBlur?.(e);
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange?.(e);
      }}
      className={cx("border border-border bg-surface p-2 text-fg", className)}
    />
  );
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

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <div className={cx("border bg-surface-2 px-3 py-2", tone === "warning" ? "border-warning" : "border-border")}>
      {tone === "warning" && <span className="text-warning">! </span>}
      {children}
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex min-h-8 items-center justify-between gap-2 border-b border-border pb-1">
        <h3 className="text-[12px] tracking-wide text-muted uppercase">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Errors that teach: a short tag (never color alone) and what to check. */
export function ErrorBox({ tag, message, children }: { tag: string; message: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-comm px-3 py-2">
      <span className="text-comm">! {tag}</span>
      <span>{message}</span>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: readonly (readonly [T, string])[];
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cx(
            "-mb-px min-h-8 border-b-2 px-3",
            value === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Modal on the native <dialog>: top layer, focus containment and Esc for free,
 * and no runtime <style> injection (the CSP forbids it).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // React's autoFocus runs before showModal, while the dialog is still closed, so the
      // browser would focus the first button (often Cancel). Focus the intended one explicitly.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onClose={() => open && onClose()}
      className={cx(
        "m-auto w-full max-w-lg border border-border bg-surface p-0 text-fg backdrop:bg-bg/80",
        className,
      )}
    >
      {open && (
        <>
          <h2 id={id} className="border-b border-border px-4 py-2 text-[14px]">
            {title}
          </h2>
          <div className="p-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-2">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Text progress, no animation: "37/247 · ID 37". */
export function Progress({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
      <div className="h-2 w-40 border border-border">
        <div className="h-full bg-muted" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-muted tabular-nums">
        {done}/{total}
        {label ? ` · ${label}` : ""}
      </span>
    </div>
  );
}
