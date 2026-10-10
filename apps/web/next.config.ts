import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const config: NextConfig = {
  // 100% static site: no application server.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@modfield/protocol", "@modfield/transport", "@modfield/ui", "@modfield/series", "@modfield/report"],
  poweredByHeader: false,
};

// MDX docs (content/docs) compiled at build time; the site stays fully static.
export default createMDX()(config);
