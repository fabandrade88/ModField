import type { ReactNode } from "react";
import type { Node, Root } from "fumadocs-core/page-tree";
import { DocsSearch } from "@/components/docs/Search";
import { DICTS, isLang, type Lang } from "@/lib/i18n";
import { source } from "@/lib/source";

function Tree({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="flex flex-col">
      {nodes.map((n, i) =>
        n.type === "page" ? (
          <li key={n.url}>
            <a href={n.url} className="block min-h-8 px-2 py-1 text-muted hover:bg-surface-2 hover:text-fg">
              {n.name}
            </a>
          </li>
        ) : n.type === "folder" ? (
          <li key={i} className="mt-2">
            <span className="block px-2 py-1 text-[11px] tracking-wide text-muted uppercase">{n.name}</span>
            <Tree nodes={n.children} />
          </li>
        ) : (
          <li key={i} className="mt-3 border-t border-border" />
        ),
      )}
    </ul>
  );
}

export default async function DocsLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : "pt";
  const tree = source.pageTree[l] as Root;
  const t = DICTS[l];
  return (
    <div className="flex min-h-dvh">
      <nav aria-label={t["docs.title"]} className="sticky top-0 flex h-dvh w-64 shrink-0 flex-col gap-2 overflow-auto border-r border-border bg-surface p-2">
        <a href={`/${l}/`} className="min-h-8 px-2 py-1 text-[12px] text-muted hover:text-fg">
          ← {t["docs.backToApp"]}
        </a>
        <a href={`/${l}/docs/`} className="px-2 text-[12px] tracking-widest text-muted uppercase">
          ModField · {t["docs.title"]}
        </a>
        <DocsSearch lang={l} />
        <Tree nodes={tree.children} />
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
