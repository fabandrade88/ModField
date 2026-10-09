import { LANGS, LANG_NAMES } from "@/lib/i18n";

export default function NotFound() {
  return (
    <main className="flex flex-col gap-2 p-4">
      <h1>404</h1>
      <nav className="flex gap-4">
        {LANGS.map((l) => (
          <a key={l} href={`/${l}/`} className="underline">
            ModField · {LANG_NAMES[l]}
          </a>
        ))}
      </nav>
    </main>
  );
}
