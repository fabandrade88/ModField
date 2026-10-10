"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LANGS, LANG_NAMES, type Lang } from "@/lib/i18n";
import { cx } from "./controls";

/** Same page in another language: the route prefix is the only difference (the docs share their slugs). */
export function langPath(pathname: string, l: Lang) {
  return pathname.replace(/^\/(pt|en|de)(?=\/|$)/, `/${l}`) || `/${l}/`;
}

/**
 * Always-visible language switch. A client navigation, not a reload: the
 * serial port, the polling and a running log stay open while the text changes.
 */
export function LangSwitch({ lang, label, vertical = false }: { lang: Lang; label: string; vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <ul aria-label={label} className={cx("flex", vertical && "flex-col md:flex-row")}>
      {LANGS.map((l) => (
        <li key={l}>
          <Link
            href={langPath(pathname, l)}
            hrefLang={l}
            lang={l}
            title={LANG_NAMES[l]}
            aria-label={LANG_NAMES[l]}
            aria-current={l === lang ? "true" : undefined}
            className={cx(
              "flex min-h-7 min-w-7 items-center justify-center px-1 text-[11px] tracking-wide uppercase",
              l === lang ? "bg-surface-2 text-fg outline outline-1 -outline-offset-1 outline-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            {l}
          </Link>
        </li>
      ))}
    </ul>
  );
}
