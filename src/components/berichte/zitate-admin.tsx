"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { formatDateDE } from "@/lib/dates";
import { SEMINAR_REPORT_KIND_LABELS } from "@/lib/seminar-reports";
import type { AdminQuoteRow } from "@/lib/seminar-reports-store";
import type { ActionResult } from "@/lib/user-error";
import { SectionTabsList, TabSection, useAction } from "@/components/admin-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";

function CopyQuoteButton({ quote }: { quote: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Zitat kopieren"
      title="Zitat kopieren"
      className="text-muted-foreground hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(quote);
          toast.success("Zitat kopiert.");
        } catch {
          toast.error("Kopieren nicht möglich.");
        }
      }}
    >
      <Copy className="h-4 w-4" />
    </Button>
  );
}

function ApprovalSwitch({
  row,
  action,
}: {
  row: AdminQuoteRow;
  action: (
    quoteId: string,
    approved: boolean
  ) => Promise<ActionResult<null>>;
}) {
  const { pending, run } = useAction();
  // Optimistisch spiegeln, damit der Schalter sofort reagiert; bei einem
  // Fehler springt er zurück.
  const [approved, setApproved] = useState(row.websiteApproved);

  return (
    <Switch
      checked={approved}
      disabled={pending}
      aria-label={
        approved
          ? "Freigabe für die Website zurückziehen"
          : "Für die Website freigeben"
      }
      onCheckedChange={async (checked) => {
        const next = Boolean(checked);
        setApproved(next);
        const ok = await run(
          async () => {
            const result = await action(row.id, next);
            if (!result.ok) throw new Error(result.error);
          },
          next ? "Zitat für die Website freigegeben." : "Freigabe zurückgezogen."
        );
        if (!ok) setApproved(!next);
      }}
    />
  );
}

function QuotesTable({
  rows,
  action,
  hint,
  emptyLabel,
}: {
  rows: AdminQuoteRow[];
  action: (
    quoteId: string,
    approved: boolean
  ) => Promise<ActionResult<null>>;
  hint: string;
  emptyLabel: string;
}) {
  return (
    <TabSection
      hint={hint}
      isEmpty={rows.length === 0}
      emptyLabel={emptyLabel}
      createAction={null}
      columns={
        <>
          <TableHead className="w-[40%]">Zitat</TableHead>
          <TableHead>Veranstaltung</TableHead>
          <TableHead className="hidden sm:table-cell">Kunde</TableHead>
          <TableHead className="hidden sm:table-cell">Datum</TableHead>
          <TableHead className="hidden lg:table-cell">Mitarbeiter/in</TableHead>
          <TableHead>Website</TableHead>
          <TableHead />
        </>
      }
    >
      {rows.map((row) => (
        <TableRow key={row.id}>
          <TableCell className="whitespace-normal italic">
            „{row.quote}“
          </TableCell>
          <TableCell>
            <Link
              href={`/berichte/${row.reportId}`}
              className="underline underline-offset-4"
            >
              {row.title}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {SEMINAR_REPORT_KIND_LABELS[row.kind]}
            </span>
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            {row.customerName}
          </TableCell>
          <TableCell className="hidden sm:table-cell">
            {formatDateDE(row.eventDate)}
          </TableCell>
          <TableCell className="hidden lg:table-cell">{row.userName}</TableCell>
          <TableCell>
            <ApprovalSwitch row={row} action={action} />
          </TableCell>
          <TableCell className="text-right">
            <CopyQuoteButton quote={row.quote} />
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

export function ZitateAdmin({
  quotes,
  action,
}: {
  quotes: AdminQuoteRow[];
  action: (
    quoteId: string,
    approved: boolean
  ) => Promise<ActionResult<null>>;
}) {
  const approved = quotes.filter((quote) => quote.websiteApproved);
  const open = quotes.filter((quote) => !quote.websiteApproved);

  const tabs = [
    {
      value: "alle",
      label: "Alle",
      rows: quotes,
      hint: "Alle von Mitarbeitenden gesammelten Zitate. Namen werden bewusst nicht erfasst.",
      emptyLabel: "Noch keine Zitate erfasst.",
    },
    {
      value: "freigegeben",
      label: "Freigegeben",
      rows: approved,
      hint: "Diese Zitate stehen im CSV-Export für die Website zur Verfügung.",
      emptyLabel: "Noch kein Zitat für die Website freigegeben.",
    },
    {
      value: "offen",
      label: "Offen",
      rows: open,
      hint: "Noch nicht geprüfte Zitate. Ein geänderter Wortlaut setzt eine bestehende Freigabe zurück.",
      emptyLabel: "Alle Zitate sind geprüft.",
    },
  ];

  return (
    <Tabs defaultValue="alle" className="gap-6">
      <SectionTabsList
        tabs={tabs.map((tab) => ({
          value: tab.value,
          label: tab.label,
          count: tab.rows.length,
        }))}
      />
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <QuotesTable
            rows={tab.rows}
            action={action}
            hint={tab.hint}
            emptyLabel={tab.emptyLabel}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
