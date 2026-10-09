"use client";

/**
 * Own error screen: the framework's default uses inline styles, which the
 * CSP blocks. Data in IndexedDB is untouched by a crash, so reloading is safe.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert" className="flex h-dvh flex-col items-start justify-center gap-3 p-6">
      <h1 className="text-[15px] text-comm">! Erro na interface · Interface error · Oberflächenfehler</h1>
      <p className="max-w-xl text-muted">{error.message}</p>
      <p className="max-w-xl text-muted">
        Os dados salvos neste navegador não foram afetados. · Data saved in this browser is not affected. · Gespeicherte Daten sind nicht betroffen.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="min-h-8 border border-accent bg-surface-2 px-3">
          Tentar de novo · Retry
        </button>
        <button type="button" onClick={() => location.reload()} className="min-h-8 border border-border bg-surface-2 px-3">
          Recarregar · Reload
        </button>
      </div>
    </main>
  );
}
