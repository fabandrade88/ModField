import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AUTHOR, SITE_URL } from "@/lib/site";
import { UI_STORAGE_KEY } from "@/lib/storage-keys";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "ModField",
  description: "Diagnóstico, simulação e registro Modbus no navegador.",
  applicationName: "ModField",
  authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
  creator: AUTHOR.name,
  openGraph: { type: "website", siteName: "ModField", url: SITE_URL },
};

export const viewport: Viewport = { colorScheme: "dark light" };

// Applies the saved theme before first paint. Inline, so scripts/csp.mjs adds its hash to the CSP.
const themeInit = `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(UI_STORAGE_KEY)})||"null");if(s&&s.state&&s.state.theme)document.documentElement.dataset.theme=s.state.theme}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt" suppressHydrationWarning>
      <head>
        {/* Extensions sometimes rewrite head scripts before React loads; don't fail hydration on that. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
