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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  // Strikte Trennung: Mitarbeitende sehen nur eigene Berichte.
  if (!found || (found.report.userId !== user.id && !isAdmin)) notFound();

  const { report, quotes } = found;
  const isOwn = report.userId === user.id;

  const author = isOwn
    ? user
    : await db.query.users.findFirst({ where: eq(users.id, report.userId) });

  const customerSuggestions = isOwn ? await listCustomerSuggestions() : [];
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
        userName={isOwn ? undefined : author ? fullName(author) : "Unbekannt"}
      />

      {isOwn && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bericht bearbeiten</CardTitle>
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

          <DeleteRequestButton
            action={deleteWithId}
            description={
              approvedQuotes > 0
                ? `Der Bericht und alle ${quotes.length} Zitate werden endgültig gelöscht — darunter ${approvedQuotes} bereits für die Website freigegebene.`
                : `Der Bericht und alle ${quotes.length} Zitate werden endgültig gelöscht.`
            }
          />
        </>
      )}

      <AuditTrail objectType="seminarbericht" objectId={id} />
    </div>
  );
}
