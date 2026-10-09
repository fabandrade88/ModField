"use client";
import "./globals.css";

/** Last-resort screen when the root layout itself fails; no inline styles (CSP). */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="pt">
      <body>
        <main role="alert" className="flex h-dvh flex-col items-start justify-center gap-3 p-6">
          <h1 className="text-[15px] text-comm">! ModField</h1>
          <p className="max-w-xl text-muted">{error.message}</p>
          <button type="button" onClick={() => location.reload()} className="min-h-8 border border-border bg-surface-2 px-3">
            Recarregar · Reload
          </button>
        </main>
      </body>
    </html>
  );
}
