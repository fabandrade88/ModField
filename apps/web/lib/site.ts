/** The public site. The agent trusts this origin without pairing UI changes (agent/cmd/modfield-agent/main.go). */
export const SITE_URL = "https://modfield.app";
/** Where scripts/dist-agent.sh publishes the agent (install.sh, binaries, checksums). */
export const DOWNLOADS_PATH = "/downloads";

/** canonical + hreflang for a path that exists in every language ("" for the tool, "docs/x/" for a page). */
export function languageAlternates(lang: string, rest: string) {
  const langs = ["pt", "en", "de"] as const;
  return {
    canonical: `/${lang}/${rest}`,
    languages: { ...Object.fromEntries(langs.map((l) => [l, `/${l}/${rest}`])), "x-default": `/pt/${rest}` },
  };
}

export const AUTHOR = { name: "Fabricio Andrade", url: "https://www.linkedin.com/in/fabriciodeandrade/" } as const;

/** The project's source on GitHub (open-source). */
export const REPO_URL = "https://github.com/fabandrade88/ModField";
