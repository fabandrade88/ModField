/**
 * Keyboard commands that a module handles (R, P...). Handlers register per
 * pane; the focused pane wins, otherwise the first pane that has one.
 */
export type CommandName = "read.now" | "read.cycle" | "tag.add";

const handlers = new Map<CommandName, Map<number, () => void>>();

export function registerCommand(name: CommandName, pane: number, fn: () => void): () => void {
  const byPane = handlers.get(name) ?? new Map<number, () => void>();
  handlers.set(name, byPane);
  byPane.set(pane, fn);
  return () => {
    if (byPane.get(pane) === fn) byPane.delete(pane);
  };
}

export function runCommand(name: CommandName, focusedPane: number): boolean {
  const byPane = handlers.get(name);
  const fn = byPane?.get(focusedPane) ?? [...(byPane?.values() ?? [])][0];
  fn?.();
  return Boolean(fn);
}
