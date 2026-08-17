import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listQuotesForAdmin } from "@/lib/seminar-reports-store";
import { BerichteNav } from "@/components/berichte/berichte-nav";
import { ZitateAdmin } from "@/components/berichte/zitate-admin";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { toggleQuoteWebsiteApproval } from "../actions";

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

      <ZitateAdmin quotes={quotes} action={toggleQuoteWebsiteApproval} />
    </div>
  );
}
