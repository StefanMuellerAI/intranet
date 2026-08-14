"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ABSENCE_LABELS,
  calcCarCents,
  calcEmployerSupplementCents,
  calcMealAllowance,
  calcReportTotals,
  durationHours,
  formatEuro,
  suggestMealDays,
  type AbsenceType,
  type MealDayInput,
  type MealRates,
} from "@/lib/expenses/calc";
import {
  MAX_RECEIPTS_TOTAL_BYTES,
  prepareReceiptFile,
  receiptsTooLargeMessage,
} from "@/lib/expenses/receipt-upload";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DECIMAL_PATTERN, DECIMAL_TITLE } from "@/lib/form-patterns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BelegItem {
  date: string;
  description: string;
  amountEuro: string;
  file: File | null;
  existingReceiptId?: string;
  existingReceiptName?: string;
}

export interface ExpenseFormDefaults {
  destination: string;
  customerPurpose: string;
  departureDate: string;
  departureTime: string;
  returnDate: string;
  returnTime: string;
  isAbroad: boolean;
  mealDays: MealDayInput[];
  transport: BelegItemDefault[];
  carKilometers: number;
  carPassengers: number;
  lodging: BelegItemDefault[];
  incidentals: BelegItemDefault[];
}

interface BelegItemDefault {
  date: string;
  description: string;
  amountCents: number;
  receiptId?: string;
  receiptName?: string;
}

function toBelegItems(defaults?: BelegItemDefault[]): BelegItem[] {
  return (defaults ?? []).map((d) => ({
    date: d.date,
    description: d.description,
    amountEuro: (d.amountCents / 100).toFixed(2).replace(".", ","),
    file: null,
    existingReceiptId: d.receiptId,
    existingReceiptName: d.receiptName,
  }));
}

function parseEuro(value: string): number {
  const n = Number(value.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function ExpenseForm({
  action,
  rates,
  submitLabel,
  defaults,
}: {
  action: (formData: FormData) => Promise<void>;
  rates: MealRates;
  submitLabel: string;
  defaults?: ExpenseFormDefaults;
}) {
  const [destination, setDestination] = useState(defaults?.destination ?? "");
  const [customerPurpose, setCustomerPurpose] = useState(
    defaults?.customerPurpose ?? ""
  );
  const [departureDate, setDepartureDate] = useState(
    defaults?.departureDate ?? ""
  );
  const [departureTime, setDepartureTime] = useState(
    defaults?.departureTime ?? ""
  );
  const [returnDate, setReturnDate] = useState(defaults?.returnDate ?? "");
  const [returnTime, setReturnTime] = useState(defaults?.returnTime ?? "");
  const [isAbroad, setIsAbroad] = useState(defaults?.isAbroad ?? false);
  const [mealDays, setMealDays] = useState<MealDayInput[]>(
    defaults?.mealDays ?? []
  );
  const [transport, setTransport] = useState<BelegItem[]>(
    toBelegItems(defaults?.transport)
  );
  const [carKilometers, setCarKilometers] = useState(
    defaults?.carKilometers ? String(defaults.carKilometers) : ""
  );
  const [carPassengers, setCarPassengers] = useState(
    defaults?.carPassengers ? String(defaults.carPassengers) : "0"
  );
  const [lodging, setLodging] = useState<BelegItem[]>(
    toBelegItems(defaults?.lodging)
  );
  const [incidentals, setIncidentals] = useState<BelegItem[]>(
    toBelegItems(defaults?.incidentals)
  );
  const [pending, startTransition] = useTransition();

  const datesComplete =
    departureDate &&
    departureTime &&
    returnDate &&
    returnTime &&
    `${returnDate}T${returnTime}` > `${departureDate}T${departureTime}`;

  const hours = datesComplete
    ? durationHours(departureDate, departureTime, returnDate, returnTime)
    : null;

  function regenerateMealDays() {
    if (!datesComplete) return;
    setMealDays(
      suggestMealDays(departureDate, departureTime, returnDate, returnTime)
    );
  }

  const meal = useMemo(
    () => calcMealAllowance(mealDays, rates),
    [mealDays, rates]
  );
  const carCents = calcCarCents(
    Number(carKilometers) || 0,
    Number(carPassengers) || 0,
    rates
  );
  const supplementCents = calcEmployerSupplementCents(meal.rows, rates);
  const totals = calcReportTotals({
    mealAllowanceCents: meal.totalCents,
    transportItemCents: transport.map((t) => parseEuro(t.amountEuro)),
    carCents,
    lodgingItemCents: lodging.map((l) => parseEuro(l.amountEuro)),
    incidentalItemCents: incidentals.map((i) => parseEuro(i.amountEuro)),
    employerSupplementCents: supplementCents,
  });

  function updateMealDay(index: number, patch: Partial<MealDayInput>) {
    setMealDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  }

  function belegBlock(
    title: string,
    hint: string,
    items: BelegItem[],
    setItems: React.Dispatch<React.SetStateAction<BelegItem[]>>,
    descriptionLabel: string
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[10rem_1fr_8rem_1fr_auto] items-end"
            >
              <div className="space-y-1">
                <Label className="text-xs">Datum</Label>
                <Input
                  type="date"
                  value={item.date}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, date: e.target.value } : x
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{descriptionLabel}</Label>
                <Input
                  value={item.description}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Betrag (€)</Label>
                <Input
                  inputMode="decimal"
                  pattern={DECIMAL_PATTERN}
                  title={DECIMAL_TITLE}
                  placeholder="0,00"
                  value={item.amountEuro}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, amountEuro: e.target.value } : x
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Beleg (PDF/JPG/PNG)</Label>
                {item.existingReceiptId && !item.file ? (
                  <p className="text-xs">
                    Vorhandener Beleg: {item.existingReceiptName}
                  </p>
                ) : null}
                <Input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, j) =>
                        j === i
                          ? { ...x, file: e.target.files?.[0] ?? null }
                          : x
                      )
                    )
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setItems((prev) => prev.filter((_, j) => j !== i))
                }
              >
                Entfernen
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setItems((prev) => [
                ...prev,
                { date: "", description: "", amountEuro: "", file: null },
              ])
            }
          >
            Position hinzufügen
          </Button>
        </CardContent>
      </Card>
    );
  }

  function handleSubmit() {
    startTransition(async () => {
      try {
        // Foto-Belege vor dem Absenden verkleinern und die Gesamtgröße
        // prüfen: Vercel weist Action-Requests über ~4,5 MB ohne Server-Log
        // ab, im Client stünde sonst nur "An unexpected response was
        // received from the server."
        const prepare = (items: BelegItem[], strong: boolean) =>
          Promise.all(
            items.map(async (item) =>
              item.file
                ? { ...item, file: await prepareReceiptFile(item.file, strong) }
                : item
            )
          );
        let [transportReady, lodgingReady, incidentalsReady] =
          await Promise.all([
            prepare(transport, false),
            prepare(lodging, false),
            prepare(incidentals, false),
          ]);
        const attachedFiles = () =>
          [...transportReady, ...lodgingReady, ...incidentalsReady].flatMap(
            (i) => (i.date && i.description && i.file ? [i.file] : [])
          );
        const totalBytes = () =>
          attachedFiles().reduce((sum, f) => sum + f.size, 0);
        if (totalBytes() > MAX_RECEIPTS_TOTAL_BYTES) {
          // Zweite Stufe: alle Bilder stärker komprimieren.
          [transportReady, lodgingReady, incidentalsReady] = await Promise.all([
            prepare(transportReady, true),
            prepare(lodgingReady, true),
            prepare(incidentalsReady, true),
          ]);
        }
        if (totalBytes() > MAX_RECEIPTS_TOTAL_BYTES) {
          toast.error(receiptsTooLargeMessage(attachedFiles()));
          return;
        }

        const formData = new FormData();
        let fileIndex = 0;
        const serializeBeleg = (items: BelegItem[]) =>
          items
            .filter((i) => i.date && i.description)
            .map((i) => {
              let idx: number | undefined;
              if (i.file) {
                idx = fileIndex;
                formData.set(`receipt_${fileIndex}`, i.file);
                fileIndex++;
              }
              return {
                date: i.date,
                description: i.description,
                amountCents: parseEuro(i.amountEuro),
                fileIndex: idx,
                existingReceiptId: i.existingReceiptId,
              };
            });

        const payload = {
          destination,
          customerPurpose,
          departureDate,
          departureTime,
          returnDate,
          returnTime,
          isAbroad,
          mealDays,
          transport: serializeBeleg(transportReady),
          carKilometers: Number(carKilometers) || 0,
          carPassengers: Number(carPassengers) || 0,
          lodging: serializeBeleg(lodgingReady),
          incidentals: serializeBeleg(incidentalsReady),
        };
        formData.set("payload", JSON.stringify(payload));
        await action(formData);
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          toast.error(err.message);
          return;
        }
        throw err;
      }
    });
  }

  const deadline = useMemo(() => {
    if (!returnDate) return null;
    const d = new Date(returnDate);
    const due = new Date(d.getFullYear(), d.getMonth() + 1, 5);
    return due.toLocaleDateString("de-DE");
  }, [returnDate]);

  return (
    <form
      action={handleSubmit}
      className="space-y-6"
      onSubmit={(e) => {
        if (!datesComplete) {
          e.preventDefault();
          toast.error("Bitte Abreise und Rückkehr vollständig angeben.");
        }
      }}
    >
      {/* Block 1 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Angaben zur Reise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Reiseziel (Ort)</Label>
              <Input
                required
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Kunde / Anlass</Label>
              <Input
                required
                value={customerPurpose}
                onChange={(e) => setCustomerPurpose(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label>Abreise: Datum</Label>
              <Input
                type="date"
                required
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Abreise: Uhrzeit</Label>
              <Input
                type="time"
                required
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Rückkehr: Datum</Label>
              <Input
                type="date"
                required
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Rückkehr: Uhrzeit</Label>
              <Input
                type="time"
                required
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Die Uhrzeit ist der Moment, in dem Sie Wohnung oder Büro verlassen
            bzw. wieder erreicht haben — nicht die Abfahrt des Zuges.
          </p>
          {hours !== null && (
            <p className="text-sm">
              Dauer gesamt:{" "}
              <strong>
                {hours.toLocaleString("de-DE", { maximumFractionDigits: 2 })}{" "}
                Std.
              </strong>
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isAbroad}
              onCheckedChange={(v) => setIsAbroad(v === true)}
            />
            Reiseziel im Ausland
          </label>
          {isAbroad && (
            <Alert>
              <AlertTitle>Auslandsreise</AlertTitle>
              <AlertDescription>
                Für Auslandsreisen gelten länderspezifische Pauschalen des
                Bundesministeriums der Finanzen; diese sind im System nicht
                hinterlegt. Die Ermittlung übernimmt die Geschäftsführung —
                die hier berechneten Inlandssätze sind nur vorläufig.
              </AlertDescription>
            </Alert>
          )}
          {deadline && (
            <p className="text-xs text-muted-foreground">
              Abgabefrist: Einreichung bis zum 5. des Folgemonats (hier:{" "}
              {deadline}); die Auszahlung erfolgt mit der nächsten
              Gehaltsabrechnung.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Block 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            2. Verpflegungspauschale (keine Belege erforderlich)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Kürzung nur, wenn die Mahlzeit von Arbeitgeber, Kunde oder Hotel
            gestellt wurde.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!datesComplete}
            onClick={regenerateMealDays}
          >
            Zeilen aus Reisezeitraum erzeugen
          </Button>
          {meal.rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Datum</TableHead>
                    <TableHead>Abwesenheit</TableHead>
                    <TableHead>Frühstück gestellt</TableHead>
                    <TableHead>Mittag gestellt</TableHead>
                    <TableHead>Abend gestellt</TableHead>
                    <TableHead className="text-right">Grundsatz</TableHead>
                    <TableHead className="text-right">Kürzung</TableHead>
                    <TableHead className="text-right">Pauschale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meal.rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(row.date).toLocaleDateString("de-DE")}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.absenceType}
                          onValueChange={(v) =>
                            updateMealDay(i, {
                              absenceType: v as AbsenceType,
                            })
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ABSENCE_LABELS).map(([k, label]) => (
                              <SelectItem key={k} value={k}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {(
                        [
                          "breakfastProvided",
                          "lunchProvided",
                          "dinnerProvided",
                        ] as const
                      ).map((key) => (
                        <TableCell key={key} className="text-center">
                          <Checkbox
                            checked={row[key]}
                            onCheckedChange={(v) =>
                              updateMealDay(i, { [key]: v === true })
                            }
                          />
                        </TableCell>
                      ))}
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
                Summe Verpflegung: {formatEuro(meal.totalCents)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Block 3 */}
      {belegBlock(
        "3. Fahrtkosten (Beleg beifügen)",
        "ÖPNV, Taxi, Bahn — Erstattung gegen Beleg.",
        transport,
        setTransport,
        "Verkehrsmittel / Strecke"
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Privat-Pkw</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 items-end">
            <div className="space-y-1">
              <Label>Gefahrene km</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={carKilometers}
                onChange={(e) => setCarKilometers(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Mitgenommene Personen</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={carPassengers}
                onChange={(e) => setCarPassengers(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Zuschlag je mitgenommener Person:{" "}
                {formatEuro(rates.passengerKmCents)}/km
              </p>
            </div>
            <p className="text-sm">
              Betrag:{" "}
              <strong className="tabular-nums">{formatEuro(carCents)}</strong>{" "}
              ({formatEuro(rates.kmCents)}/km)
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Block 4 */}
      {belegBlock(
        "4. Übernachtung (Rechnung auf die GmbH)",
        "Rechnung auf die StefanAI Solutions GmbH ausstellen lassen.",
        lodging,
        setLodging,
        "Hotel / Ort"
      )}

      {/* Block 5 */}
      {belegBlock(
        "5. Reisenebenkosten (Beleg beifügen)",
        "Parken, ÖPNV, Maut, Gepäckaufbewahrung …",
        incidentals,
        setIncidentals,
        "Art (Parken, ÖPNV, Maut …)"
      )}

      {/* Block 6 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">6. Erstattungsbetrag</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm max-w-sm">
            <div className="flex justify-between">
              <dt>Verpflegungspauschale (steuerfrei)</dt>
              <dd className="tabular-nums">
                {formatEuro(totals.mealAllowanceCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Fahrtkosten (Belege)</dt>
              <dd className="tabular-nums">
                {formatEuro(totals.transportCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Fahrtkosten Privat-Pkw</dt>
              <dd className="tabular-nums">{formatEuro(totals.carCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Übernachtung</dt>
              <dd className="tabular-nums">{formatEuro(totals.lodgingCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Reisenebenkosten</dt>
              <dd className="tabular-nums">
                {formatEuro(totals.incidentalsCents)}
              </dd>
            </div>
            {totals.employerSupplementCents > 0 && (
              <div className="flex justify-between">
                <dt>Arbeitgeber-Zuschlag (pauschal versteuert)</dt>
                <dd className="tabular-nums">
                  {formatEuro(totals.employerSupplementCents)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Gesamterstattung</dt>
              <dd className="tabular-nums">{formatEuro(totals.totalCents)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending || !datesComplete}>
        {pending ? "Wird eingereicht …" : submitLabel}
      </Button>
    </form>
  );
}
