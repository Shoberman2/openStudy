import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev route indicator sits bottom-left over page content; hide it.
  devIndicators: false,
  // Apple root certificates are read at runtime to verify App Store signed data (spec 11.5).
  outputFileTracingIncludes: {
    "/api/apple/*": ["./certs/apple/**/*"],
  },
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
