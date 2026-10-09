"use client";
import {
  Activity,
  BookOpen,
  Cpu,
  FileText,
  HardDrive,
  LineChart,
  PenLine,
  Plug,
  Radar,
  Settings,
  Table2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { PLANNED_PHASE, type ModuleId } from "@/lib/modules";
import { ConnectionModule } from "./ConnectionModule";
import { PlannedModule } from "./PlannedModule";
import { ReadModule } from "./ReadModule";
import { SettingsModule } from "./SettingsModule";
import { TrafficModule } from "./TrafficModule";

export const MODULE_ICONS: Record<ModuleId, LucideIcon> = {
  connection: Plug,
  read: Table2,
  write: PenLine,
  scan: Radar,
  sim: Cpu,
  traffic: Activity,
  logger: LineChart,
  report: FileText,
  settings: Settings,
  storage: HardDrive,
  docs: BookOpen,
};

export function renderModule(id: ModuleId, pane: number): ReactNode {
  switch (id) {
    case "connection":
      return <ConnectionModule />;
    case "read":
      return <ReadModule pane={pane} />;
    case "traffic":
      return <TrafficModule />;
    case "settings":
      return <SettingsModule />;
    default:
      return <PlannedModule phase={PLANNED_PHASE[id] ?? 2} />;
  }
}
