"use client";
import {
  FC,
  ModbusError,
  encodeValue,
  formatTagValue,
  isBitTable,
  registerCount,
  toEngineering,
  toRaw,
  type ByteOrder,
  type DataType,
  type LinearScale,
} from "@modfield/protocol";
import type { ModbusClient } from "@modfield/transport";
import type { WriteResult } from "./db";

/** What gets written, resolved from a tag or a manual address. */
export interface WritePlan {
  unitId: number;
  table: "holding" | "coil";
  offset: number;
  type: DataType;
  order: ByteOrder;
  scale?: LinearScale;
  unit?: string;
  decimals?: number;
  stringLength?: number;
  tagId?: string;
  tagName?: string;
}

const INT_TYPES: DataType[] = ["INT16", "UINT16", "INT32", "UINT32"];

/** Function code a write will use: coils 05, one register 06 (unless forced), else 16. */
export function writeFunction(p: WritePlan, forceMultiple: boolean): number {
  if (p.table === "coil") return FC.WRITE_SINGLE_COIL;
  return registerCount(p.type, p.stringLength) === 1 && !forceMultiple ? FC.WRITE_SINGLE_REGISTER : FC.WRITE_MULTIPLE_REGISTERS;
}

/**
 * Engineering value typed by the user -> raw value to encode. Throws a
 * RangeError the dialog shows before anything is sent.
 */
export function toRawValue(p: WritePlan, text: string): number | string | boolean {
  if (p.table === "coil") {
    const s = text.trim().toLowerCase();
    if (["1", "on", "true", "liga", "ein"].includes(s)) return true;
    if (["0", "off", "false", "desliga", "aus"].includes(s)) return false;
    throw new RangeError("coil: 0/1");
  }
  if (p.type === "STRING") return text;
  const eng = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(eng)) throw new RangeError("not a number");
  let raw = p.scale ? toRaw(eng, p.scale) : eng;
  if (INT_TYPES.includes(p.type)) raw = Math.round(raw);
  encodeValue(raw, p.type, p.order); // validates the range
  return raw;
}

export async function readCurrent(client: ModbusClient, p: WritePlan): Promise<string> {
  if (p.table === "coil") return (await client.readBits(p.unitId, "coil", p.offset, 1))[0] ? "1" : "0";
  const raw = await client.read(p.unitId, "holding", p.offset, p.type, p.order, p.stringLength);
  const v = typeof raw === "number" && p.scale ? toEngineering(raw, p.scale) : raw;
  return formatTagValue(p, v);
}

export async function executeWrite(
  client: ModbusClient,
  p: WritePlan,
  raw: number | string | boolean,
  opts: { forceMultiple: boolean; confirmToken: string },
): Promise<{ result: WriteResult; detail?: string }> {
  try {
    if (p.table === "coil") await client.writeCoil(p.unitId, p.offset, raw as boolean, opts.confirmToken);
    else
      await client.writeValue(p.unitId, p.offset, raw as number | string, p.type, p.order, {
        forceMultiple: opts.forceMultiple,
        stringLength: p.stringLength,
        confirmToken: opts.confirmToken,
      });
    return { result: "ok" };
  } catch (e) {
    if (e instanceof ModbusError) {
      // No answer: the slave may or may not have applied it. Never retry; read to find out.
      if (e.code === "TIMEOUT" || e.code === "CRC_ERROR" || e.code === "PORT_DISCONNECTED") return { result: "unknown", detail: e.tag };
      if (e.code === "MODBUS_EXCEPTION") return { result: "exception", detail: e.tag };
      return { result: "error", detail: e.tag };
    }
    return { result: "error", detail: String(e) };
  }
}

export function isWritable(table: string): table is "holding" | "coil" {
  return table === "holding" || table === "coil";
}

export { isBitTable };
