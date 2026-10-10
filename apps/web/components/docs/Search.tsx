"use client";
import { useDocsSearch } from "fumadocs-core/search/client";
import { useState } from "react";
import { useT } from "@/components/i18n";

/** Local search over a static index: works offline, nothing leaves the browser. */
export function DocsSearch({ lang }: { lang: string }) {
  const t = useT();
  const { search, setSearch, query } = useDocsSearch({ type: "static", from: "/api/search", locale: lang });
  const [open, setOpen] = useState(false);
  const results = query.data && query.data !== "empty" ? query.data : [];
  return (
    <div className="relative">
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("docs.search")}
        aria-label={t("docs.search")}
        className="min-h-8 w-full border border-border bg-surface px-2 text-[13px]"
      />
      {open && search.trim() && (
        <ul role="listbox" className="absolute z-10 mt-1 max-h-96 w-full overflow-auto border border-border bg-surface">
          {results.length === 0 ? (
            <li className="px-2 py-1 text-muted">{t("docs.search.empty")}</li>
          ) : (
            results.slice(0, 20).map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <a href={r.url} className={`block min-h-8 px-2 py-1 hover:bg-surface-2 ${r.type === "page" ? "" : "pl-5 text-muted"}`}>
                  {String(r.content).replace(/<[^>]+>/g, "")}
                </a>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
