"use client";
import { useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";
import { NUMBERED_MODULES } from "@/lib/modules";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";
import { FirstUse } from "./FirstUse";
import { HelpOverlay } from "./HelpOverlay";
import { PropertiesPanel } from "./PropertiesPanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Workspace } from "./Workspace";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Keyboard first, mouse always. Shortcuts avoid browser combos the technician
 * relies on (Alt+arrows, Ctrl+P, Space); one-letter keys only fire outside
 * text fields.
 */
function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (e.key === "Escape" && ui.helpOpen) {
        ui.set({ helpOpen: false });
        return;
      }
      if (!ui.firstUseDone) {
        const n = Number(e.key);
        if (n >= 1 && n <= 3 && !isTyping(e.target)) {
          document.querySelectorAll<HTMLButtonElement>("[data-option]")[n - 1]?.click();
          e.preventDefault();
        }
        return;
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void useConnection
          .getState()
          .toggle()
          .then((ok) => ok || ui.openModule("connection"));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || ui.helpOpen) return;

      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= NUMBERED_MODULES.length) {
        ui.openModule(NUMBERED_MODULES[n - 1]!);
      } else if (e.key === "[") {
        ui.moveFocus(-1);
      } else if (e.key === "]") {
        ui.moveFocus(1);
      } else if (e.key === "r" || e.key === "R") {
        if (!runCommand("read.now", ui.focused)) return;
      } else if (e.key === "p" || e.key === "P") {
        if (!runCommand("read.cycle", ui.focused)) return;
      } else if (e.key === "?") {
        ui.set({ helpOpen: true });
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function AppShell() {
  const theme = useUi((s) => s.theme);
  const firstUseDone = useUi((s) => s.firstUseDone);
  const helpOpen = useUi((s) => s.helpOpen);
  // Persisted UI state is read after hydration, so the first paint matches the static HTML.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const off = useUi.persist.onFinishHydration(() => setHydrated(true));
    void useUi.persist.rehydrate();
    return off;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // Ask the browser not to evict our data under storage pressure.
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  useShortcuts();

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <Workspace />
        <PropertiesPanel />
      </div>
      <StatusBar />
      {hydrated && !firstUseDone && <FirstUse />}
      {helpOpen && <HelpOverlay />}
    </div>
  );
}
