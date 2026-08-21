import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listQuotesForAdmin } from "@/lib/seminar-reports-store";
import { BerichteNav } from "@/components/berichte/berichte-nav";
import { ZitateAdmin } from "@/components/berichte/zitate-admin";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  toggleQuoteWebsiteApproval,
  updateQuoteTextAction,
} from "../actions";

export const metadata = { title: "Zitate" };

export default async function ZitatePage() {
  await requireAdmin();
  const quotes = await listQuotesForAdmin();
  const approved = quotes.filter((quote) => quote.websiteApproved).length;

  return (
    <div>
      <PageHeader
        title="Zitate"
        description="Anonyme Zitate von Teilnehmenden aus allen Berichten — freigegebene Zitate lassen sich auf der Website verwenden"
      />
      <BerichteNav isAdmin />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          render={<Link href="/api/exports/berichte-zitate" prefetch={false} />}
        >
          <Download className="mr-2 h-4 w-4" /> Freigegebene als CSV
        </Button>
        <span className="text-sm text-muted-foreground">
          {approved} von {quotes.length} Zitaten freigegeben
        </span>
      </div>

      <p className="mb-6 text-sm text-muted-foreground">
        Für die Einbindung auf der Website gibt es die Schnittstelle{" "}
        <code className="text-xs">GET /api/v1/website/zitate</code>. Sie liefert
        genau die hier freigegebenen Zitate (nur Id und Wortlaut) und braucht
        einen API-Key vom Typ „Website (nur Zitate)“ aus den Einstellungen.
        Hinweis: Nicht verwertbare Formulierungen — etwa eine vorangestellte
        Punktzahl aus dem Feedbackbogen — lassen sich über das Stift-Symbol
        direkt hier korrigieren; eine bestehende Freigabe bleibt dabei erhalten.
        Ändert dagegen die verfassende Person den Wortlaut später im Bericht,
        entfällt die Freigabe automatisch und muss hier erneut gesetzt werden.
      </p>

      <ZitateAdmin
        quotes={quotes}
        action={toggleQuoteWebsiteApproval}
        editAction={updateQuoteTextAction}
      />
    </div>
  );
}
