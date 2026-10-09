import { EXCEPTION_NAMES, type ErrorCode, type ExceptionCode } from "./codes";

/**
 * Messages are for developers and logs; the UI shows localized text keyed by
 * `code` and `exception`.
 */
export class ModbusError extends Error {
  readonly code: ErrorCode;
  readonly exception: ExceptionCode | undefined;

  constructor(code: ErrorCode, message: string, exception?: ExceptionCode) {
    super(message);
    this.name = "ModbusError";
    this.code = code;
    this.exception = exception;
  }

  /** "MODBUS_EXCEPTION 02" or "TIMEOUT": the short tag shown next to values. */
  get tag(): string {
    return this.exception === undefined
      ? this.code
      : `${this.code} ${this.exception.toString(16).padStart(2, "0").toUpperCase()}`;
  }
}

export function exceptionError(fc: number, exception: ExceptionCode): ModbusError {
  return new ModbusError(
    "MODBUS_EXCEPTION",
    `Function ${fc.toString().padStart(2, "0")} rejected by slave: ${EXCEPTION_NAMES[exception]}`,
    exception,
  );
}
