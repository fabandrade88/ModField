"use client";
import { importRegisterMap, type ImportError, type ImportRow } from "@modfield/protocol";
import { useState } from "react";
import { Button, Dialog, Field, Input, Select } from "@/components/controls";
import { useT, type T } from "@/components/i18n";
import { db, newId } from "@/lib/db";
import { useTags } from "@/lib/hooks";
import { useUi } from "@/store/ui";

export function importErrorText(t: T, e: ImportError): string {
  return t(`import.err.${e.code}`, { value: e.value ?? "" });
}

/** Register map import from a vendor spreadsheet saved as CSV. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const profileId = useUi((s) => s.profileId);
  const tags = useTags();
  const [text, setText] = useState("");
  const [base, setBase] = useState<0 | 1>(1);
  const [unitId, setUnitId] = useState(1);
  const rows: ImportRow[] = text.trim() ? importRegisterMap(text, { base, defaultUnitId: unitId }) : [];
  const valid = rows.filter((r) => r.tag);

  const run = async () => {
    const start = tags.length;
    await db.tags.bulkAdd(valid.map((r, i) => ({ ...r.tag!, id: newId(), profileId, sort: start + i })));
    setText("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("import.title")}
      className="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!valid.length} onClick={() => void run()}>
            {t("import.run", { n: valid.length })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted">{t("import.help")}</p>
        <code className="text-[12px] break-all text-muted">tag,descricao,unit_id,funcao,endereco,tipo,ordem,bruto_min,bruto_max,eng_min,eng_max,unidade,casas</code>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("import.file")}>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="min-h-8"
              onChange={(e) => void e.target.files?.[0]?.text().then(setText)}
            />
          </Field>
          <Field label={t("read.base")}>
            <Select
              value={base}
              options={[
                { value: 0, label: t("read.base.0") },
                { value: 1, label: t("read.base.1") },
              ] as const}
              onChange={setBase}
            />
          </Field>
          <Field label={t("import.defaultUnit")}>
            <Input type="number" min={1} max={247} value={unitId} onChange={(e) => setUnitId(Math.min(247, Math.max(1, e.target.valueAsNumber || 1)))} className="w-20" />
          </Field>
        </div>
        <Field label={t("import.paste")}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="border border-border bg-surface p-2 text-[12px]" />
        </Field>
        {rows.length > 0 && (
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className="border-b border-border/50">
                    <td className="pr-2 text-muted tabular-nums">{r.line}</td>
                    {r.tag ? (
                      <td>
                        {r.tag.name} · {r.tag.unitId} · {r.tag.table} {r.tag.offset} · {r.tag.type}
                        {r.tag.unit ? ` · ${r.tag.unit}` : ""}
                      </td>
                    ) : (
                      <td className="text-comm">! {r.errors.map((e) => importErrorText(t, e)).join("; ")}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
