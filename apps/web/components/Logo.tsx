// The ModField mark — the same art as the favicon (app/icon.svg), inlined so it
// can sit beside the product name as a logo. Server-safe (no hooks).
export function Logo({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="6" fill="#1a1b26" />
      <path d="M5 22h4V10h4v12h4V10h4v12h4V10h2" fill="none" stroke="#7aa2f7" strokeWidth="2" />
    </svg>
  );
}
