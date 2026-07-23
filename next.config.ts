import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Beleg-Uploads (PDF/JPG/PNG) laufen über Server Actions
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
