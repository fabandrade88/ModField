import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/components/docs/mdx";
import { DICTS, isLang } from "@/lib/i18n";
import { source } from "@/lib/source";

export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams("slug", "lang");
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug?: string[] }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  return { title: page ? `${page.data.title} · ModField` : "ModField", description: page?.data.description };
}

export default async function DocPage({ params }: { params: Promise<{ lang: string; slug?: string[] }> }) {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page || !isLang(lang)) notFound();
  const Body = page.data.body;
  const toc = page.data.toc.filter((x) => x.depth <= 3);
  return (
    <div className="flex gap-8 px-6 py-6">
      <article className="docs min-w-0 flex-1 text-[14px] leading-relaxed">
        <h1 className="mb-1 text-[20px]">{page.data.title}</h1>
        {page.data.description && <p className="mb-4 text-muted">{page.data.description}</p>}
        <Body components={mdxComponents} />
      </article>
      {toc.length > 1 && (
        <aside className="sticky top-6 hidden h-fit w-56 shrink-0 xl:block">
          <p className="mb-2 text-[11px] tracking-wide text-muted uppercase">{DICTS[lang]["docs.onThisPage"]}</p>
          <ul className="flex flex-col gap-1 text-[12px]">
            {toc.map((x) => (
              <li key={x.url} className={x.depth === 3 ? "pl-3" : ""}>
                <a href={x.url} className="text-muted hover:text-fg">
                  {x.title}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
