"use client";
import { THEMES } from "@modfield/ui";
import { Button, Field, Select } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import { LANGS, LANG_NAMES, type Lang } from "@/lib/i18n";
import { useUi } from "@/store/ui";

export function SettingsModule() {
  const t = useT();
  const lang = useLang();
  const theme = useUi((s) => s.theme);
  const set = useUi((s) => s.set);
  return (
    <div className="flex max-w-md flex-col gap-4 p-3">
      <Field label={t("settings.theme")}>
        <Select value={theme} options={THEMES.map((th) => ({ value: th.id, label: th.name }))} onChange={(id) => set({ theme: id })} />
      </Field>
      <Field label={t("settings.language")}>
        <Select<Lang>
          value={lang}
          options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          onChange={(l) => location.assign(`/${l}/`)}
        />
      </Field>
      <div>
        <Button onClick={() => set({ firstUseDone: false })}>{t("settings.firstUse")}</Button>
      </div>
    </div>
  );
}
