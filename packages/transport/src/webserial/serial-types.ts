/**
 * The subset of the Web Serial API we use. Declared locally because the API
 * is not in TypeScript's DOM lib; the simulated port implements the same shape.
 */
export interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialPortLike extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

export interface SerialLike extends EventTarget {
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

export function getSerial(): SerialLike | undefined {
  return typeof navigator !== "undefined" && "serial" in navigator
    ? (navigator as unknown as { serial: SerialLike }).serial
    : undefined;
}

/** USB-serial chip vendors seen in the field. */
export const USB_VENDORS: Record<number, string> = {
  0x0403: "FTDI",
  0x1a86: "WCH (CH340)",
  0x10c4: "Silicon Labs (CP210x)",
  0x067b: "Prolific",
  0x2341: "Arduino",
};

export function describePort(info: SerialPortInfo): string {
  if (info.usbVendorId === undefined) return "Porta serial";
  const hex = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
  const vendor = USB_VENDORS[info.usbVendorId] ?? "USB";
  return `${vendor} ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}`;
}
