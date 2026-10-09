export type Table = "coil" | "discrete" | "input" | "holding";

/** Prefix digit of the classic notation: 0xxxx coils, 1xxxx discrete, 3xxxx input, 4xxxx holding. */
const PREFIX: Record<Table, number> = { coil: 0, discrete: 1, input: 3, holding: 4 };
const BY_PREFIX: Record<number, Table> = { 0: "coil", 1: "discrete", 3: "input", 4: "holding" };

export type AddressBase = 0 | 1;

/** Address shown to the user -> protocol offset (0..65535). */
export function toOffset(displayed: number, base: AddressBase): number {
  const offset = displayed - base;
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff) {
    throw new RangeError(`address ${displayed} out of range for base ${base}`);
  }
  return offset;
}

export function fromOffset(offset: number, base: AddressBase): number {
  return offset + base;
}

/**
 * Parses the classic notation. Five digits ("40001") cover offsets 0..9998,
 * six digits ("400001") the full 0..65535 range. The classic notation is
 * always 1-based: 40001 is offset 0.
 */
export function parseClassic(text: string): { table: Table; offset: number } {
  const s = text.trim();
  if (!/^\d{5,6}$/.test(s)) throw new RangeError(`"${text}" is not a 5 or 6 digit Modbus address`);
  const table = BY_PREFIX[Number(s[0])];
  if (!table) throw new RangeError(`"${text}": prefix ${s[0]} is not 0, 1, 3 or 4`);
  const n = Number(s.slice(1));
  if (n < 1 || n > 0x10000) throw new RangeError(`"${text}": register number out of range`);
  return { table, offset: n - 1 };
}

export function formatClassic(table: Table, offset: number): string {
  const n = offset + 1;
  return `${PREFIX[table]}${String(n).padStart(n > 9999 ? 5 : 4, "0")}`;
}
