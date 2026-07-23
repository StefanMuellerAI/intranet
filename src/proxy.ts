import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk-Session-Handling für alle Routen. Der Zugriffsschutz erfolgt
 * ressourcenbasiert in den Layouts, Pages und Route-Handlern selbst:
 * - App-Bereich: src/app/(app)/layout.tsx leitet Unangemeldete zu /anmelden,
 *   Datenzugriffe prüfen requireUser/requireAdmin (src/lib/auth.ts)
 * - /api/v1: eigene API-Key-Auth, /api/receipts: HMAC-Signatur,
 *   /api/cron: Secret-Prüfung, /api/exports: Admin-Prüfung in der Route
 */
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
