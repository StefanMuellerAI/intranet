import { CalendarRange, PartyPopper, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type DashboardSalesNewsItem = {
  id: string;
  customerName: string;
  volumeLabel: string;
  soldByName: string;
  deliveryLabel: string;
  wonLabel: string;
};

/**
 * Feierliche Anzeige gewonnener Aufträge auf dem Dashboard. Erscheint nur,
 * solange es Sales-Nachrichten der letzten 14 Tage gibt — ohne aktuelle
 * Erfolge wird die Karte komplett ausgeblendet.
 */
export function DashboardSalesNews({
  items,
}: {
  items: DashboardSalesNewsItem[];
}) {
  if (items.length === 0) return null;

  return (
    <Card
      data-testid="sales-nachrichten"
      className="relative mb-6 bg-linear-to-br from-amber-100 via-yellow-50 to-orange-100 ring-amber-500/40 dark:from-amber-950 dark:via-yellow-950/60 dark:to-orange-950 dark:ring-amber-400/30"
    >
      {/* Lichtstreif — läuft alle paar Sekunden feierlich über die Karte */}
      <div
        aria-hidden
        className="sales-news-shine pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-linear-to-r from-transparent via-white/50 to-transparent dark:via-white/10"
      />
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-100">
          <PartyPopper className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          Gewonnene Aufträge
          <span aria-hidden>🎉</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul
          className={
            items.length > 1 ? "grid gap-3 md:grid-cols-2" : "grid gap-3"
          }
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg bg-background/70 p-4 ring-1 ring-amber-500/25 dark:bg-background/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-base font-semibold">{item.customerName}</p>
                <p className="text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">
                  {item.volumeLabel}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Trophy
                    className="h-4 w-4 text-amber-600 dark:text-amber-400"
                    aria-hidden
                  />
                  <span>
                    Gewonnen von{" "}
                    <span className="font-medium text-foreground">
                      {item.soldByName}
                    </span>
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarRange className="h-4 w-4" aria-hidden />
                  <span>Leistung vsl. {item.deliveryLabel}</span>
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Gewonnen am {item.wonLabel}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
