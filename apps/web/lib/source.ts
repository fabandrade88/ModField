import { defineI18n } from "fumadocs-core/i18n";
import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

export const docsI18n = defineI18n({ languages: ["pt", "en", "de"], defaultLanguage: "pt", parser: "dir" });

const docs = defineDocs({ dir: "content/docs" });

/** Field guide: one task per page, pt/en/de, inside the app at /<lang>/docs. */
export const source = loader({ baseUrl: "/docs", source: docs.toFumadocsSource(), i18n: docsI18n });
