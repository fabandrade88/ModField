// Response headers for the deployed static site. The script/style policy is a
// per-page <meta> CSP (scripts/csp.mjs, allowed by hash); these are the headers
// a <meta> tag cannot carry — framing, transport, referrer and features.
//
// Single source of truth: scripts/serve.mjs applies them to the preview so it
// matches production, scripts/gen-vercel.mjs writes them into vercel.json, and
// a unit test fails if vercel.json drifts from this list.
export const SECURITY_HEADERS = [
  // frame-ancestors is ignored inside <meta>, so clickjacking defence must be a
  // header. Nothing on the site is meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // HTTPS only, remembered for two years. Add `; preload` after confirming every
  // subdomain is HTTPS to submit to the preload list.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Web Serial (RTU over USB) is the only powerful feature the app uses; deny the rest.
  { key: "Permissions-Policy", value: "serial=(self), geolocation=(), camera=(), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
