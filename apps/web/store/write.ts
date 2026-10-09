"use client";
import { create } from "zustand";
import type { ByteOrder, DataType } from "@modfield/protocol";

export type WriteTarget =
  | { mode: "tag"; tagId: string | undefined }
  | { mode: "address"; unitId: number; table: "holding" | "coil"; offset: number; type: DataType; order: ByteOrder };

export const useWrite = create<{
  target: WriteTarget;
  /** Bumped by the W key so the module focuses the value field. */
  focusNonce: number;
  setTarget: (t: WriteTarget) => void;
  requestFocus: () => void;
}>()((set) => ({
  target: { mode: "tag", tagId: undefined },
  focusNonce: 0,
  setTarget: (target) => set({ target }),
  requestFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
}));
