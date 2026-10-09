import type { NextConfig } from "next";

const config: NextConfig = {
  // 100% static site: no application server.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@modfield/protocol", "@modfield/transport", "@modfield/ui", "@modfield/series"],
  poweredByHeader: false,
};

export default config;
