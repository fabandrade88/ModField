"use client";
import { Button, Section } from "@/components/controls";
import { useLang, useT } from "@/components/i18n";
import type { Lang } from "@/lib/i18n";

const POPULAR: { slug: string; title: Record<Lang, string> }[] = [
  { slug: "quick-start-usb", title: { pt: "Início rápido: USB-RS485", en: "Quick start: USB-RS485", de: "Schnellstart: USB-RS485" } },
  { slug: "quick-start-tcp", title: { pt: "Início rápido: Modbus TCP", en: "Quick start: Modbus TCP", de: "Schnellstart: Modbus TCP" } },
  { slug: "guides/find-slave", title: { pt: "Encontrar um escravo desconhecido", en: "Find an unknown slave", de: "Einen unbekannten Slave finden" } },
  { slug: "guides/float32", title: { pt: "Ler um FLOAT32", en: "Read a FLOAT32", de: "Einen FLOAT32 lesen" } },
  { slug: "guides/log-24h", title: { pt: "Registrar 24 horas", en: "Log for 24 hours", de: "24 Stunden aufzeichnen" } },
  { slug: "guides/report", title: { pt: "Gerar o relatório", en: "Make the report", de: "Bericht erstellen" } },
  { slug: "troubleshooting", title: { pt: "Solução de problemas", en: "Troubleshooting", de: "Fehlerbehebung" } },
  { slug: "hardware", title: { pt: "Hardware RS-485", en: "RS-485 hardware", de: "RS-485-Hardware" } },
];

/** Docs open in a new tab: navigating this one would drop the serial connection. */
export function DocsModule() {
  const t = useT();
  const lang = useLang();
  return (
    <div className="flex max-w-xl flex-col gap-4 p-3">
      <div className="flex flex-col gap-1">
        <div>
          <Button variant="primary" onClick={() => window.open(`/${lang}/docs/`, "_blank", "noopener")}>
            {t("docs.open")} ↗
          </Button>
        </div>
        <p className="text-[12px] text-muted">{t("docs.open.hint")}</p>
      </div>
      <Section title={t("docs.popular")}>
        <ul className="flex flex-col">
          {POPULAR.map((p) => (
            <li key={p.slug}>
              <a href={`/${lang}/docs/${p.slug}/`} target="_blank" rel="noopener" className="block min-h-8 py-1 text-accent underline">
                {p.title[lang]}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
