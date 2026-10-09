"use client";
import { useT } from "@/components/i18n";

export function PlannedModule({ phase }: { phase: number }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-start justify-center gap-1 p-4">
      <p>{t("module.planned", { phase })}</p>
      <p className="text-muted">{t("module.planned.hint")}</p>
    </div>
  );
}
