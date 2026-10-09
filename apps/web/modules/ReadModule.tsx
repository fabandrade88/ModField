"use client";
import { Tabs } from "@/components/controls";
import { useT } from "@/components/i18n";
import { useUi } from "@/store/ui";
import { BlockRead } from "./read/BlockRead";
import { TagTable } from "./read/TagTable";

export function ReadModule({ pane }: { pane: number }) {
  const t = useT();
  const tab = useUi((s) => s.readTab);
  const set = useUi((s) => s.set);
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-2">
        <Tabs
          value={tab}
          onChange={(readTab) => set({ readTab })}
          tabs={[
            ["tags", t("read.tab.tags")],
            ["block", t("read.tab.block")],
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">{tab === "tags" ? <TagTable pane={pane} /> : <BlockRead pane={pane} />}</div>
    </div>
  );
}
