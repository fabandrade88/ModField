import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Built once into a static JSON file: search works offline, nothing is sent anywhere.
export const revalidate = false;
export const dynamic = "force-static";

export const { staticGET: GET } = createFromSource(source, {
  localeMap: { pt: { language: "portuguese" }, en: { language: "english" }, de: { language: "german" } },
});
