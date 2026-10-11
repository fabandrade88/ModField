"use client";
import { Globe } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { LANGS, LANG_NAMES, type Lang } from "@/lib/i18n";

/** Same page in another language: the route prefix is the only difference (the docs share their slugs). */
export function langPath(pathname: string, l: Lang) {
  return pathname.replace(/^\/(pt|en|de)(?=\/|$)/, `/${l}`) || `/${l}/`;
}

/**
 * Always-visible language menu: shows the code, lists the names. A native
 * select under the label keeps the keyboard and the phone picker. Changing it
 * is a client navigation, not a reload: the serial port, the polling and a
 * running log stay open while the text changes.
 */
export function LangSwitch({ lang, label }: { lang: Lang; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="relative flex min-h-7 items-center gap-1 px-1.5 text-[11px] tracking-wide text-muted uppercase focus-within:outline focus-within:outline-1 focus-within:outline-accent hover:bg-surface-2 hover:text-fg">
      <Globe size={13} strokeWidth={1.5} aria-hidden className="hidden md:block" />
      <span aria-hidden>{lang}</span>
      <span aria-hidden className="text-[9px]">▾</span>
      <select
        aria-label={label}
        title={label}
        value={lang}
        onChange={(e) => router.push(langPath(pathname, e.target.value as Lang))}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0"
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
