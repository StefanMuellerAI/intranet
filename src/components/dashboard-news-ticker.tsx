import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardNewsTicker({
  items,
}: {
  items: { id: string; title: string; body: string }[];
}) {
  if (items.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Neuigkeiten</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Keine aktuellen Nachrichten.
          </p>
        </CardContent>
      </Card>
    );
  }

  const segments = items.map(
    (item) => `${item.title}: ${item.body.replace(/\s+/g, " ").trim()}`
  );
  // Doppelt für nahtlosen Marquee-Loop
  const track = [...segments, ...segments];

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Neuigkeiten</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className="news-ticker relative overflow-hidden rounded-md border bg-muted/40 py-2.5"
          aria-hidden="true"
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-linear-to-r from-muted/40 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-linear-to-l from-muted/40 to-transparent" />
          <div className="news-ticker-track flex w-max items-center gap-8 whitespace-nowrap px-4 text-sm">
            {track.map((text, index) => (
              <span
                key={`${text}-${index}`}
                className="inline-flex items-center gap-8"
              >
                <span className="text-foreground/90">{text}</span>
                <span className="text-muted-foreground/50" aria-hidden>
                  ·
                </span>
              </span>
            ))}
          </div>
        </div>

        <ul className="news-ticker-static space-y-2 text-sm">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-md border bg-muted/40 px-3 py-2"
            >
              <span className="font-medium">{item.title}</span>
              <span className="text-muted-foreground"> — {item.body}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
