import { parseClassic, toOffset, type AddressBase, type Table } from "./address";
import { BYTE_ORDERS, DATA_TYPES, type ByteOrder, type DataType } from "./datatypes";
import type { TagDef } from "./tags";

/** Splits CSV text with "," or ";" (detected from the header) and double-quoted fields. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const TABLES: Record<string, Table> = {
  holding: "holding",
  input: "input",
  coil: "coil",
  coils: "coil",
  discrete: "discrete",
  "4x": "holding",
  "3x": "input",
  "0x": "coil",
  "1x": "discrete",
};

export type ImportErrorCode = "missingTag" | "badAddress" | "badTable" | "badType" | "badOrder" | "badUnitId" | "partialScale";

export interface ImportError {
  code: ImportErrorCode;
  /** The offending cell, for the message. */
  value?: string;
}

export interface ImportRow {
  line: number;
  tag?: Omit<TagDef, "id">;
  errors: ImportError[];
}

/**
 * Register map import. Columns (header names, any order): tag, descricao,
 * unit_id, funcao, endereco, tipo, ordem, bruto_min, bruto_max, eng_min,
 * eng_max, unidade, casas. Addresses in 5/6-digit classic notation set the
 * table themselves; plain numbers use `base`.
 */
export function importRegisterMap(text: string, opts: { base: AddressBase; defaultUnitId: number }): ImportRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };
  const num = (s: string) => (s === "" ? undefined : Number(s.replace(",", ".")));

  return rows.map((r, idx) => {
    const errors: ImportError[] = [];
    const name = get(r, "tag");
    if (!name) errors.push({ code: "missingTag" });

    const addrText = get(r, "endereco");
    let table = TABLES[get(r, "funcao").toLowerCase()];
    let offset: number | undefined;
    try {
      if (/^\d{5,6}$/.test(addrText) && !get(r, "funcao")) {
        const c = parseClassic(addrText);
        table = c.table;
        offset = c.offset;
      } else {
        offset = toOffset(Number(addrText), opts.base);
      }
    } catch {
      errors.push({ code: "badAddress", value: addrText });
    }
    if (!table) errors.push({ code: "badTable", value: get(r, "funcao") });

    const typeText = (get(r, "tipo") || "UINT16").toUpperCase();
    const type = (DATA_TYPES as readonly string[]).includes(typeText) ? (typeText as DataType) : undefined;
    if (!type) errors.push({ code: "badType", value: typeText });
    const orderText = (get(r, "ordem") || "ABCD").toUpperCase();
    const order = (BYTE_ORDERS as readonly string[]).includes(orderText) ? (orderText as ByteOrder) : undefined;
    if (!order) errors.push({ code: "badOrder", value: orderText });

    const unitId = num(get(r, "unit_id")) ?? opts.defaultUnitId;
    if (!Number.isInteger(unitId) || unitId < 1 || unitId > 247) errors.push({ code: "badUnitId", value: String(unitId) });

    const scaleVals = ["bruto_min", "bruto_max", "eng_min", "eng_max"].map((c) => num(get(r, c)));
    const scale =
      scaleVals.every((v) => v !== undefined && Number.isFinite(v)) && scaleVals[0] !== scaleVals[1]
        ? { rawMin: scaleVals[0]!, rawMax: scaleVals[1]!, engMin: scaleVals[2]!, engMax: scaleVals[3]! }
        : undefined;
    if (scaleVals.some((v) => v !== undefined) && !scale) errors.push({ code: "partialScale" });

    const decimals = num(get(r, "casas"));
    if (errors.length || offset === undefined || !table || !type || !order) return { line: idx + 2, errors };
    return {
      line: idx + 2,
      errors,
      tag: {
        name,
        description: get(r, "descricao") || undefined,
        unitId,
        table,
        offset,
        type,
        order,
        scale,
        unit: get(r, "unidade") || undefined,
        decimals: decimals !== undefined && Number.isInteger(decimals) ? decimals : undefined,
      },
    };
  });
}
