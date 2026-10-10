"use client";
import { THEMES } from "@modfield/ui";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Button, Field, Input, Section, Select } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import { db, type CompanyRow } from "@/lib/db";
import { LANGS, LANG_NAMES, type Lang } from "@/lib/i18n";
import { logoToPng } from "@/lib/trendImage";
import { useUi } from "@/store/ui";

export function SettingsModule() {
  const t = useT();
  const lang = useLang();
  const theme = useUi((s) => s.theme);
  const set = useUi((s) => s.set);
  return (
    <div className="flex max-w-2xl flex-col gap-4 p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("settings.theme")}>
          <Select value={theme} options={THEMES.map((th) => ({ value: th.id, label: th.name }))} onChange={(id) => set({ theme: id })} />
        </Field>
        <Field label={t("settings.language")}>
          <Select<Lang> value={lang} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} onChange={(l) => location.assign(`/${l}/`)} />
        </Field>
      </div>
      <div>
        <Button onClick={() => set({ firstUseDone: false })}>{t("settings.firstUse")}</Button>
      </div>
      <CompanySection />
    </div>
  );
}

const EMPTY: CompanyRow = { id: "company", name: "", taxId: "", address: "", phone: "", email: "", website: "" };

/** Once only: the company data and logo printed on every report. */
function CompanySection() {
  const t = useT();
  const company = useLiveQuery(() => db.company.get("company"), []) ?? EMPTY;
  const [error, setError] = useState<string>();
  const up = (patch: Partial<CompanyRow>) => void db.company.put({ ...company, ...patch });
  const fields: [keyof Omit<CompanyRow, "id" | "logo">, string][] = [
    ["name", t("company.name")],
    ["taxId", t("company.taxId")],
    ["address", t("company.address")],
    ["phone", t("company.phone")],
    ["email", t("company.email")],
    ["website", t("company.website")],
  ];
  return (
    <Section title={t("company.title")}>
      <p className="text-muted">{t("company.help")}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
        {fields.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input value={company[k]} onChange={(e) => up({ [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {company.logo ? (
          // White box: logos are usually made for paper.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logo} alt={t("company.logo")} className="h-12 max-w-48 border border-border bg-white object-contain p-1" />
        ) : (
          <span className="text-muted">{t("company.noLogo")}</span>
        )}
        <label className="inline-flex min-h-8 cursor-pointer items-center border border-border bg-surface-2 px-3 hover:border-muted">
          {t("company.logo.upload")}
          <input
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            className="sr-only"
            aria-label={t("company.logo.upload")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setError(undefined);
                up({ logo: await logoToPng(f) });
              } catch {
                setError(t("company.logo.failed"));
              }
            }}
          />
        </label>
        {company.logo && (
          <Button variant="ghost" onClick={() => up({ logo: undefined })}>
            {t("common.delete")}
          </Button>
        )}
      </div>
      {error && <p className="text-[12px] text-comm">! {error}</p>}
    </Section>
  );
}
