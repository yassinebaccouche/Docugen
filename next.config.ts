import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/docx-templates": ["./app/Docx/**/*"],
    "/api/docx-templates/*/import": ["./app/Docx/**/*"],
    "/api/generate": ["./app/Docx/**/*"],
    "/api/templates/*/inspect": ["./app/Docx/**/*"],
    "/api/templates/*/thumbnail": ["./app/Docx/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
