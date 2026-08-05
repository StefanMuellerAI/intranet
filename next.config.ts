import type { NextConfig } from "next";

/**
 * Defense-in-depth Security-Header für alle Antworten. Die CSP beschränkt
 * sich bewusst auf Direktiven, die das Laden legitimer App- und Clerk-
 * Ressourcen nicht beeinträchtigen (kein default-src/script-src) — sie
 * unterbinden Clickjacking (frame-ancestors), <base>-Injection und aktive
 * Plugin-Inhalte (object-src). Datei-Downloads setzen zusätzlich nosniff und
 * Content-Disposition: attachment direkt in ihren Route-Handlern.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Framework-/Versionsauskunft nicht preisgeben
  poweredByHeader: false,
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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
