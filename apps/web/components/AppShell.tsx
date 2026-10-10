"use client";
import { useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";
import { db } from "@/lib/db";
import { NUMBERED_MODULES } from "@/lib/modules";
import { ensureSeed } from "@/lib/seed";
import { autoConnectAgent } from "@/store/agent";
import { useLogger } from "@/store/logger";
import { MarkerDialog } from "@/modules/LoggerModule";
import { openWriteFromShortcut } from "@/modules/WriteModule";
import { useConnection } from "@/store/connection";
import { useUi } from "@/store/ui";
import { CommandPalette } from "./CommandPalette";
import { FirstUse } from "./FirstUse";
import { HelpOverlay } from "./HelpOverlay";
import { PropertiesPanel } from "./PropertiesPanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { Workspace } from "./Workspace";
import { useLang } from "./i18n";

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
      // Open dialogs (help, palette, write confirmation) handle their own keys.
      if (document.querySelector("dialog[open]")) return;
      if (!ui.firstUseDone) {
        const n = Number(e.key);
        if (n >= 1 && n <= 3 && !isTyping(e.target)) {
          document.querySelectorAll<HTMLButtonElement>("[data-option]")[n - 1]?.click();
          e.preventDefault();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set({ paletteOpen: true });
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
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;

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
      } else if (e.key === "a" || e.key === "A") {
        if (!runCommand("tag.add", ui.focused)) {
          ui.set({ readTab: "tags" });
          ui.openModule("read");
          setTimeout(() => runCommand("tag.add", useUi.getState().focused), 50);
        }
      } else if (e.key === "w" || e.key === "W") {
        openWriteFromShortcut();
      } else if (e.key === "l" || e.key === "L") {
        if (useLogger.getState().session) void useLogger.getState().stop();
        else if (!runCommand("logger.toggle", ui.focused)) ui.openModule("logger");
      } else if (e.key === "m" || e.key === "M") {
        if (useLogger.getState().session) ui.set({ markerOpen: true });
        else ui.openModule("logger");
      } else if (e.key === "g" || e.key === "G") {
        if (!runCommand("report.generate", ui.focused)) ui.openModule("report");
      } else if (e.key === "/") {
        ui.set({ paletteOpen: true });
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
  const lang = useLang();
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

  // First run: the demo profile. A profile deleted in another tab falls back to the first one.
  useEffect(() => {
    if (!hydrated) return;
    void ensureSeed(lang).then(async () => {
      const id = useUi.getState().profileId;
      if (!(await db.profiles.get(id))) {
        const first = await db.profiles.orderBy("name").first();
        if (first) useUi.getState().set({ profileId: first.id });
      }
      await useLogger.getState().resume();
      await autoConnectAgent();
    });
  }, [hydrated, lang]);

  useEffect(() => {
    // Offline after the first visit. Not in development: the dev server has no sw.js.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

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
      <CommandPalette />
      <MarkerDialog />
    </div>
  );
}
