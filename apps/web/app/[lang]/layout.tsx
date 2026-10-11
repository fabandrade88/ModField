import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n";
import { LANGS, isLang } from "@/lib/i18n";
import { languageAlternates } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

const DESCRIPTION: Record<string, string> = {
  pt: "Diagnóstico, simulação e registro Modbus RTU e TCP no navegador, com relatório de comissionamento.",
  en: "Modbus RTU and TCP diagnostics, simulation and logging in the browser, with a commissioning report.",
  de: "Modbus-RTU- und -TCP-Diagnose, Simulation und Aufzeichnung im Browser, mit Inbetriebnahmeprotokoll.",
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return { description: DESCRIPTION[lang], alternates: languageAlternates(lang, ""), openGraph: { locale: lang, url: `/${lang}/` } };
}

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <I18nProvider lang={lang}>{children}</I18nProvider>;
}
