import type { MetadataRoute } from "next";
import { LANGS } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

/** The tool and every docs page, in each language, linked to its translations. */
export default function sitemap(): MetadataRoute.Sitemap {
  const rests = ["", ...source.getPages("pt").map((p) => `${p.url.replace(/^\/pt\//, "").replace(/\/?$/, "/")}`)];
  return rests.flatMap((rest) =>
    LANGS.map((l) => ({
      url: `${SITE_URL}/${l}/${rest}`,
      alternates: { languages: Object.fromEntries(LANGS.map((o) => [o, `${SITE_URL}/${o}/${rest}`])) },
    })),
  );
}
