import { ModbusError } from "@modfield/protocol";
import type { Key } from "./i18n";

export interface ErrorContext {
  unit?: number;
  timeout?: number;
}

/** Localized, teaching message for an error; see the troubleshooting table in the docs. */
export function describeError(
  t: (k: Key, p?: Record<string, string | number>) => string,
  e: unknown,
  ctx: ErrorContext = {},
): { tag: string; message: string } {
  if (e instanceof ModbusError) {
    const key =
      e.code === "MODBUS_EXCEPTION" && e.exception !== undefined
        ? (`error.MODBUS_EXCEPTION.${e.exception.toString(16).padStart(2, "0").toUpperCase()}` as Key)
        : (`error.${e.code}` as Key);
    return {
      tag: e.tag,
      message: t(key, { unit: ctx.unit ?? "?", timeout: ctx.timeout ?? "?", detail: e.message }),
    };
  }
  const detail = e instanceof Error ? e.message : String(e);
  return { tag: "ERRO", message: t("error.generic", { detail }) };
}
