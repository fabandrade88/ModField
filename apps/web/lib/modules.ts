export const NUMBERED_MODULES = ["connection", "read", "write", "scan", "sim", "traffic", "logger", "report"] as const;
export const FOOTER_MODULES = ["settings", "storage", "docs"] as const;
/** The Home screen: how to start, the agent download, where help is. Key H. */
export const HOME = "home" as const;
export type ModuleId = typeof HOME | (typeof NUMBERED_MODULES)[number] | (typeof FOOTER_MODULES)[number];

/** Roadmap phase in which a module that is still a placeholder arrives. */
export const PLANNED_PHASE: Partial<Record<ModuleId, number>> = {};
