export const FC = {
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0f,
  WRITE_MULTIPLE_REGISTERS: 0x10,
  ENCAPSULATED_INTERFACE: 0x2b,
} as const;
export type FunctionCode = (typeof FC)[keyof typeof FC];

/** MEI type for Read Device Identification (43/14). */
export const MEI_READ_DEVICE_ID = 0x0e;

export const EXCEPTION = {
  ILLEGAL_FUNCTION: 0x01,
  ILLEGAL_DATA_ADDRESS: 0x02,
  ILLEGAL_DATA_VALUE: 0x03,
  SERVER_DEVICE_FAILURE: 0x04,
  ACKNOWLEDGE: 0x05,
  SERVER_DEVICE_BUSY: 0x06,
  MEMORY_PARITY_ERROR: 0x08,
  GATEWAY_PATH_UNAVAILABLE: 0x0a,
  GATEWAY_TARGET_FAILED: 0x0b,
} as const;
export type ExceptionCode = (typeof EXCEPTION)[keyof typeof EXCEPTION];

export const EXCEPTION_NAMES: Record<ExceptionCode, string> = {
  0x01: "ILLEGAL FUNCTION",
  0x02: "ILLEGAL DATA ADDRESS",
  0x03: "ILLEGAL DATA VALUE",
  0x04: "SERVER DEVICE FAILURE",
  0x05: "ACKNOWLEDGE",
  0x06: "SERVER DEVICE BUSY",
  0x08: "MEMORY PARITY ERROR",
  0x0a: "GATEWAY PATH UNAVAILABLE",
  0x0b: "GATEWAY TARGET DEVICE FAILED TO RESPOND",
};

export function isExceptionCode(n: number): n is ExceptionCode {
  return n in EXCEPTION_NAMES;
}

/** Fixed error codes shared by the browser and the agent. */
export const ERROR_CODES = [
  "TIMEOUT",
  "CRC_ERROR",
  "INVALID_RESPONSE",
  "MODBUS_EXCEPTION",
  "PORT_BUSY",
  "PORT_DISCONNECTED",
  "PERMISSION_DENIED",
  "CONN_REFUSED",
  "NOT_PAIRED",
  "ORIGIN_REJECTED",
  "CONFIRM_REQUIRED",
  "PROTOCOL_MISMATCH",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const LIMITS = {
  maxReadRegisters: 125,
  maxReadBits: 2000,
  maxWriteRegisters: 123,
  maxWriteCoils: 1968,
  minUnitId: 1,
  maxUnitId: 247,
} as const;
