import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { fullName, requireUser } from "@/lib/auth";
import {
  getSeminarReportWithQuotes,
  listCustomerSuggestions,
} from "@/lib/seminar-reports-store";
import { BerichtDetails } from "@/components/berichte/bericht-details";
import { BerichtForm } from "@/components/berichte/bericht-form";
import { BerichteNav } from "@/components/berichte/berichte-nav";
import { DeleteRequestButton } from "@/components/delete-request-button";
import { PageHeader } from "@/components/page-header";
import { AuditTrail } from "@/components/request-meta";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteSeminarReportAction,
  updateSeminarReportAction,
} from "../actions";

export const metadata = { title: "Bericht" };

export default async function BerichtDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  const found = await getSeminarReportWithQuotes(id);
  // Berichte sind teamweit lesbar. Bearbeiten darf, wem der Bericht gehört —
  // und der Admin, der die Zitate für die Website verantwortet. Löschen bleibt
  // der verfassenden Person vorbehalten.
  if (!found) notFound();

  const { report, quotes } = found;
  const isOwn = report.userId === user.id;
  const canEdit = isOwn || isAdmin;

  const author = isOwn
    ? user
    : await db.query.users.findFirst({ where: eq(users.id, report.userId) });
  const authorName = isOwn ? undefined : author ? fullName(author) : "Unbekannt";

  const customerSuggestions = canEdit ? await listCustomerSuggestions() : [];
  const approvedQuotes = quotes.filter((quote) => quote.websiteApproved).length;

  const updateWithId = updateSeminarReportAction.bind(null, id);
  const deleteWithId = deleteSeminarReportAction.bind(null, id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={report.title}
        description={`${report.customerName} — Bericht zur Veranstaltung`}
      />
      <BerichteNav isAdmin={isAdmin} />

      <BerichtDetails
        report={report}
        quotes={quotes}
        userName={authorName}
      />

      {canEdit && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bericht bearbeiten</CardTitle>
              {!isOwn && (
                <CardDescription>
                  Bericht von {authorName} — als Admin können Sie ihn
                  nachträglich anpassen, etwa um ein Zitat in eine verwertbare
                  Form zu bringen. Die Änderung erscheint im Verlauf. Bereits
                  erteilte Website-Freigaben bleiben dabei bestehen.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <BerichtForm
                action={updateWithId}
                customerSuggestions={customerSuggestions}
                submitLabel="Änderungen speichern"
                successMessage="Bericht aktualisiert."
                defaults={{
                  kind: report.kind,
                  customerName: report.customerName,
                  title: report.title,
                  eventDate: report.eventDate,
                  durationDays: report.durationDays.toLocaleString("de-DE"),
                  whatWentWell: report.whatWentWell,
                  whatWentBadly: report.whatWentBadly,
                  improvements: report.improvements,
                  feedbackRating: report.feedbackRating,
                  quotes: quotes.map((quote) => ({
                    id: quote.id,
                    quote: quote.quote,
                  })),
                }}
              />
            </CardContent>
          </Card>

          {isOwn && (
            <DeleteRequestButton
              action={deleteWithId}
              description={
                approvedQuotes > 0
                  ? `Der Bericht und alle ${quotes.length} Zitate werden endgültig gelöscht — darunter ${approvedQuotes} bereits für die Website freigegebene.`
                  : `Der Bericht und alle ${quotes.length} Zitate werden endgültig gelöscht.`
              }
            />
          )}
        </>
      )}

      {/* Der Verlauf ist Metainformation zur Bearbeitung, nicht Inhalt des
          Berichts — er bleibt der verfassenden Person und dem Admin vorbehalten. */}
      {(isOwn || isAdmin) && (
        <AuditTrail objectType="seminarbericht" objectId={id} />
      )}
    </div>
  );
}
