import { NextResponse } from "next/server";
import { retryDueDeliveries } from "@/lib/webhooks";

export const preferredRegion = "fra1";

/** Vercel Cron: fällige Webhook-Wiederholungen ausführen (Backoff-Retry). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`)
    return NextResponse.json({ fehler: "Kein Zugriff." }, { status: 401 });

  const retried = await retryDueDeliveries();
  return NextResponse.json({ wiederholt: retried });
}
