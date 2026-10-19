import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev route indicator sits bottom-left over page content; hide it.
  devIndicators: false,
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
