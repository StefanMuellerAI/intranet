import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Beleg-Uploads (PDF/JPG/PNG) laufen über Server Actions
      bodySizeLimit: "15mb",
    },
  },
  // Logo für die Stundenzettel-PDF-Erzeugung in den Server-Bundles mitliefern
  outputFileTracingIncludes: {
    "/**": ["./public/logo.png"],
  },
};

export default nextConfig;
