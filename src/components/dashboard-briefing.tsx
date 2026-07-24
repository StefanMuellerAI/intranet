import Link from "next/link";
import type { CalendarAbsence } from "@/lib/absences";
import { buildBriefingText } from "@/lib/briefing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardBriefing({
  absences,
  todayISO,
  rangeEndISO,
}: {
  absences: CalendarAbsence[];
  todayISO: string;
  rangeEndISO: string;
}) {
  const text = buildBriefingText(absences, todayISO, rangeEndISO);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-baseline justify-between gap-3 text-base">
          <span>Kurzbriefing · Die nächsten 2 Wochen</span>
          <Link
            href="/kalender"
            className="text-sm font-normal underline underline-offset-4"
          >
            Zum Kalender
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-foreground/90">{text}</p>
      </CardContent>
    </Card>
  );
}
