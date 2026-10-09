"use client";
import { create } from "zustand";
import type { ByteOrder, DataType, Table } from "@modfield/protocol";

export interface SelectedTag {
  unitId: number;
  table: Table;
  offset: number;
  type: DataType;
  order: ByteOrder;
  registers: number[];
  value: number | string | undefined;
}

export const useSelection = create<{ tag: SelectedTag | undefined; select: (t: SelectedTag | undefined) => void }>()(
  (set) => ({ tag: undefined, select: (tag) => set({ tag }) }),
);
