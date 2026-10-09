"use client";
import { create } from "zustand";
import type { ByteOrder, DataType, Table } from "@modfield/protocol";

/** A row read in the Block tab, not saved as a tag. */
export interface BlockSelection {
  kind: "block";
  unitId: number;
  table: Table;
  offset: number;
  type: DataType;
  order: ByteOrder;
  registers: number[];
  value: number | string | undefined;
}

export type Selection = BlockSelection | { kind: "tag"; tagId: string };

export const useSelection = create<{ sel: Selection | undefined; select: (s: Selection | undefined) => void }>()((set) => ({
  sel: undefined,
  select: (sel) => set({ sel }),
}));
