"use client";
import { useEffect } from "react";
import { LANGS, LANG_NAMES, detectLang } from "@/lib/i18n";

/** Static export has no middleware: the root picks the language on the client. */
export default function Root() {
  useEffect(() => {
    location.replace(`/${detectLang(navigator.languages ?? [navigator.language])}/`);
  }, []);
  return (
    <nav className="flex gap-4 p-4">
      {LANGS.map((l) => (
        <a key={l} href={`/${l}/`} className="underline">
          {LANG_NAMES[l]}
        </a>
      ))}
    </nav>
  );
}
