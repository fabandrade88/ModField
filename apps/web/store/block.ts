"use client";
import { create } from "zustand";
import type { ByteOrder, DataType, Radix, Table } from "@modfield/protocol";

export interface BlockParams {
  unitId: number;
  table: Table;
  base: 0 | 1;
  classic: boolean;
  /** Address as shown, in the chosen base. */
  address: number;
  quantity: number;
  type: DataType;
  order: ByteOrder;
  stringLength: number;
  radix: Radix;
}

/** Block (ad-hoc) read parameters; in a store so the command palette can set them. */
export const useBlock = create<BlockParams & { setBlock: (p: Partial<BlockParams>) => void }>()((set) => ({
  unitId: 1,
  table: "input",
  base: 0,
  classic: false,
  address: 0,
  quantity: 4,
  type: "UINT16",
  order: "ABCD",
  stringLength: 16,
  radix: "dec",
  setBlock: (p) => set(p),
}));
