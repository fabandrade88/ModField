"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_THEME } from "@modfield/ui";
import type { ModuleId } from "@/lib/modules";
import { UI_STORAGE_KEY } from "@/lib/storage-keys";

export type Layout = 1 | 2 | 4;
export type ConnTab = "rtu" | "tcp" | "demo";

interface UiState {
  theme: string;
  layout: Layout;
  /** Module shown in each of the 4 pane slots; slots beyond `layout` are hidden but kept. */
  panes: ModuleId[];
  focused: number;
  propsOpen: boolean;
  firstUseDone: boolean;
  connTab: ConnTab;
  helpOpen: boolean;

  openModule: (id: ModuleId) => void;
  focusPane: (i: number) => void;
  moveFocus: (delta: 1 | -1) => void;
  setLayout: (l: Layout) => void;
  setPane: (i: number, id: ModuleId) => void;
  set: (patch: Partial<Pick<UiState, "theme" | "propsOpen" | "firstUseDone" | "connTab" | "helpOpen">>) => void;
}


/** localStorage can throw (private mode, blocked site data); the app must still work. */
const safeStorage = createJSONStorage(() => ({
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Preferences are a convenience; losing them is fine.
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
}));

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME.id,
      layout: 2,
      panes: ["connection", "traffic", "read", "settings"],
      focused: 0,
      propsOpen: true,
      firstUseDone: false,
      connTab: "rtu",
      helpOpen: false,

      openModule: (id) =>
        set((s) => {
          const panes = [...s.panes];
          panes[s.focused] = id;
          return { panes };
        }),
      focusPane: (i) => set({ focused: Math.max(0, Math.min(i, get().layout - 1)) }),
      moveFocus: (delta) => set((s) => ({ focused: (s.focused + delta + s.layout) % s.layout })),
      setLayout: (layout) => set((s) => ({ layout, focused: Math.min(s.focused, layout - 1) })),
      setPane: (i, id) =>
        set((s) => {
          const panes = [...s.panes];
          panes[i] = id;
          return { panes, focused: i };
        }),
      set: (patch) => set(patch),
    }),
    {
      name: UI_STORAGE_KEY,
      storage: safeStorage,
      // Rehydrated by AppShell after mount, so the first render matches the static HTML.
      skipHydration: true,
      partialize: ({ theme, layout, panes, propsOpen, firstUseDone, connTab }) => ({
        theme,
        layout,
        panes,
        propsOpen,
        firstUseDone,
        connTab,
      }),
    },
  ),
);
