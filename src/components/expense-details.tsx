import type { ExpenseItem, ExpenseReport, Receipt } from "@/db/schema";
import { formatDateDE } from "@/lib/dates";
import { ABSENCE_LABELS, formatEuro, type AbsenceType } from "@/lib/expenses/calc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function ExpenseDetails({
  report,
  items,
  receipts,
}: {
  report: ExpenseReport;
  items: ExpenseItem[];
  receipts: Receipt[];
}) {
  const mealRows = items.filter((i) => i.kind === "verpflegung");
  const carRow = items.find((i) => i.kind === "pkw");
  const blocks = [
    {
      title: "3. Fahrtkosten (Belege)",
      rows: items.filter((i) => i.kind === "fahrt"),
    },
    {
      title: "4. Übernachtung",
      rows: items.filter((i) => i.kind === "uebernachtung"),
    },
    {
      title: "5. Reisenebenkosten",
      rows: items.filter((i) => i.kind === "nebenkosten"),
    },
  ];

  const receiptFor = (itemId: string) =>
    receipts.find((r) => r.itemId === itemId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Angaben zur Reise</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Reiseziel (Ort)</dt>
              <dd>
                {report.destination}
                {report.isAbroad ? " (Ausland)" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Kunde / Anlass</dt>
              <dd>{report.customerPurpose}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Abreise</dt>
              <dd>
                {formatDateDE(report.departureDate)}, {report.departureTime}{" "}
                Uhr
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rückkehr</dt>
              <dd>
                {formatDateDE(report.returnDate)}, {report.returnTime} Uhr
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {report.isAbroad && (
        <Alert>
          <AlertTitle>Auslandsreise</AlertTitle>
          <AlertDescription>
            Länderspezifische BMF-Sätze sind nicht hinterlegt; die berechneten
            Inlandssätze sind vorläufig. Die Ermittlung der Auslandspauschalen
            übernimmt die Geschäftsführung.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Verpflegungspauschale</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Abwesenheit</TableHead>
                <TableHead>Frühstück</TableHead>
                <TableHead>Mittag</TableHead>
                <TableHead>Abend</TableHead>
                <TableHead className="text-right">Grundsatz</TableHead>
                <TableHead className="text-right">Kürzung</TableHead>
                <TableHead className="text-right">Pauschale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mealRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.itemDate ? formatDateDE(row.itemDate) : "—"}
                  </TableCell>
                  <TableCell>
                    {row.absenceType
                      ? ABSENCE_LABELS[row.absenceType as AbsenceType]
                      : "—"}
                  </TableCell>
                  <TableCell>{row.breakfastProvided ? "ja" : "nein"}</TableCell>
                  <TableCell>{row.lunchProvided ? "ja" : "nein"}</TableCell>
                  <TableCell>{row.dinnerProvided ? "ja" : "nein"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEuro(row.grossCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    −{formatEuro(row.reductionCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatEuro(row.netCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-right text-sm font-medium">
            Summe Verpflegung: {formatEuro(report.mealAllowanceCents)}
          </p>
        </CardContent>
      </Card>

      {blocks.map(
        (block) =>
          block.rows.length > 0 && (
            <Card key={block.title}>
              <CardHeader>
                <CardTitle className="text-base">{block.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Datum</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Betrag</TableHead>
                      <TableHead>Beleg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.rows.map((row) => {
                      const receipt = receiptFor(row.id);
                      return (
                        <TableRow key={row.id}>
                          <TableCell>
                            {row.itemDate ? formatDateDE(row.itemDate) : "—"}
                          </TableCell>
                          <TableCell>{row.description}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatEuro(row.amountCents ?? 0)}
                          </TableCell>
                          <TableCell>
                            {receipt ? (
                              <a
                                href={`/api/receipts/${receipt.id}`}
                                target="_blank"
                                className="underline underline-offset-4"
                              >
                                {receipt.filename}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">
                                kein Beleg
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
      )}

      {carRow && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Privat-Pkw</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {carRow.kilometers} km
            {carRow.passengers
              ? `, ${carRow.passengers} mitgenommene Person(en)`
              : ""}{" "}
            → <strong>{formatEuro(carRow.netCents)}</strong>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">6. Erstattungsbetrag</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm max-w-sm">
            <div className="flex justify-between">
              <dt>Verpflegungspauschale (steuerfrei)</dt>
              <dd className="tabular-nums">
                {formatEuro(report.mealAllowanceCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Fahrtkosten (Belege)</dt>
              <dd className="tabular-nums">
                {formatEuro(report.transportCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Fahrtkosten Privat-Pkw</dt>
              <dd className="tabular-nums">{formatEuro(report.carCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Übernachtung</dt>
              <dd className="tabular-nums">{formatEuro(report.lodgingCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Reisenebenkosten</dt>
              <dd className="tabular-nums">
                {formatEuro(report.incidentalsCents)}
              </dd>
            </div>
            {report.employerSupplementCents > 0 && (
              <div className="flex justify-between">
                <dt>Arbeitgeber-Zuschlag (pauschal versteuert)</dt>
                <dd className="tabular-nums">
                  {formatEuro(report.employerSupplementCents)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Gesamterstattung</dt>
              <dd className="tabular-nums">{formatEuro(report.totalCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Beleganzahl: {receipts.length} (ergibt sich aus den Uploads). Die
            digitale Einreichung ersetzt die Unterschrift; die Genehmigung im
            System ersetzt „Geprüft und freigegeben (Geschäftsführung)&ldquo; —
            beides ist im Audit-Log dokumentiert.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
