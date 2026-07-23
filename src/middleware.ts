import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Öffentlich: Anmeldung, API v1 (eigene Key-Auth), Beleg-Downloads mit
// Signatur (eigene HMAC-Prüfung) und Cron (Secret-Prüfung).
const isPublicRoute = createRouteMatcher([
  "/anmelden(.*)",
  "/api/v1(.*)",
  "/api/receipts(.*)",
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
