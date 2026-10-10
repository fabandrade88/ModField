import { ModbusError } from "@modfield/protocol";
import type { Key } from "./i18n";

export interface ErrorContext {
  unit?: number;
  timeout?: number;
}

/** Anchor of each error in the troubleshooting page (the same in every language). */
export function troubleshootingAnchor(e: ModbusError): string {
  if (e.code === "MODBUS_EXCEPTION") {
    const code = (e.exception ?? 0).toString(16).padStart(2, "0");
    return ["01", "02", "03"].includes(code) ? `exception-${code}` : "exceptions";
  }
  return (
    {
      TIMEOUT: "timeout",
      CRC_ERROR: "crc",
      INVALID_RESPONSE: "invalid-response",
      PORT_BUSY: "port-busy",
      PORT_DISCONNECTED: "port-disconnected",
      PERMISSION_DENIED: "permission-denied",
      CONN_REFUSED: "conn-refused",
      NOT_PAIRED: "not-paired",
      ORIGIN_REJECTED: "origin-rejected",
      CONFIRM_REQUIRED: "confirm-required",
      PROTOCOL_MISMATCH: "protocol-mismatch",
    } as Record<string, string>
  )[e.code] ?? "";
}

/** Localized, teaching message for an error; see the troubleshooting table in the docs. */
export function describeError(
  t: (k: Key, p?: Record<string, string | number>) => string,
  e: unknown,
  ctx: ErrorContext = {},
): { tag: string; message: string; anchor?: string } {
  if (e instanceof ModbusError) {
    const key =
      e.code === "MODBUS_EXCEPTION" && e.exception !== undefined
        ? (`error.MODBUS_EXCEPTION.${e.exception.toString(16).padStart(2, "0").toUpperCase()}` as Key)
        : (`error.${e.code}` as Key);
    let message = t(key, { unit: ctx.unit ?? "?", timeout: ctx.timeout ?? "?", detail: e.message });
    // The agent tells which group owns the device (dialout on Debian, uucp on Arch).
    const group = (e as ModbusError & { group?: string }).group;
    if (e.code === "PERMISSION_DENIED" && group) message += " " + t("error.PERMISSION_DENIED.group", { group });
    return { tag: e.tag, message, anchor: troubleshootingAnchor(e) };
  }
  const detail = e instanceof Error ? e.message : String(e);
  return { tag: "ERRO", message: t("error.generic", { detail }) };
}
