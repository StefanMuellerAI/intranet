import type { SeminarReport, SeminarReportQuote } from "@/db";
import { formatDateDE } from "@/lib/dates";
import {
  FEEDBACK_RATING_LABELS,
  SEMINAR_REPORT_KIND_LABELS,
  formatDurationDays,
  type FeedbackRating,
} from "@/lib/seminar-reports";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{title}</dt>
      <dd className="whitespace-pre-wrap">{text}</dd>
    </div>
  );
}

export function BerichtDetails({
  report,
  quotes,
  userName,
}: {
  report: SeminarReport;
  quotes: SeminarReportQuote[];
  /** Gesetzt, wenn der Bericht einer anderen Person gehört (Admin-Sicht). */
  userName?: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Angaben zur Veranstaltung</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {userName && (
              <div>
                <dt className="text-muted-foreground">Mitarbeiter/in</dt>
                <dd>{userName}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Art</dt>
              <dd>{SEMINAR_REPORT_KIND_LABELS[report.kind]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Titel</dt>
              <dd>{report.title}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Kunde / Organisation</dt>
              <dd>{report.customerName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Datum</dt>
              <dd>{formatDateDE(report.eventDate)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dauer</dt>
              <dd>{formatDurationDays(report.durationDays)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Feedback der Teilnehmenden
              </dt>
              <dd>
                {
                  FEEDBACK_RATING_LABELS[
                    report.feedbackRating as FeedbackRating
                  ]
                }
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rückblick</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm">
            <TextBlock title="Was lief gut?" text={report.whatWentWell} />
            <TextBlock title="Was lief nicht gut?" text={report.whatWentBadly} />
            <TextBlock
              title="Was möchten Sie beim nächsten Mal verbessern?"
              text={report.improvements}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Zitate von Teilnehmenden ({quotes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zu diesem Bericht wurden keine Zitate erfasst.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {quotes.map((quote) => (
                <li
                  key={quote.id}
                  className="flex flex-wrap items-start justify-between gap-2 border-l-2 border-border pl-3"
                >
                  <p className="italic">„{quote.quote}“</p>
                  {quote.websiteApproved && (
                    <Badge variant="secondary">für Website freigegeben</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
