import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n";
import { LANGS, isLang } from "@/lib/i18n";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}
