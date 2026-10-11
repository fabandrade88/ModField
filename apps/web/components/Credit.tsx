import { AUTHOR } from "@/lib/site";

/** "Created by" line with the author's LinkedIn. Server-safe: the docs render it too. */
export function Credit({ label, className }: { label: string; className?: string }) {
  return (
    <p className={`text-[11px] text-muted ${className ?? ""}`}>
      {label}{" "}
      <a href={AUTHOR.url} target="_blank" rel="noopener author" className="whitespace-nowrap text-accent underline hover:text-fg">
        {AUTHOR.name} ↗
      </a>
    </p>
  );
}
