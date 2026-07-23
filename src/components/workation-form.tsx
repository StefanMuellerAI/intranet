"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { countWorkdays } from "@/lib/dates";
import {
  classifyCountry,
  validateWorkation,
  WORKATION_DECLARATIONS,
  type DeclarationKey,
} from "@/lib/workation/validate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { WorkationRequest } from "@/db/schema";

export function WorkationForm({
  action,
  usedWorkDaysThisYear,
  yearlyLimitDays,
  consecutiveLimitDays,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  usedWorkDaysThisYear: number;
  yearlyLimitDays: number;
  consecutiveLimitDays: number;
  defaults?: Partial<WorkationRequest>;
  submitLabel: string;
}) {
  const [country, setCountry] = useState(defaults?.country ?? "");
  const [startDate, setStartDate] = useState(defaults?.startDate ?? "");
  const [endDate, setEndDate] = useState(defaults?.endDate ?? "");
  const [workDaysManual, setWorkDaysManual] = useState<string | null>(
    defaults?.workDays != null ? String(defaults.workDays) : null
  );
  const [daysInCountry, setDaysInCountry] = useState<string>(
    defaults?.daysInCountryThisYear != null
      ? String(defaults.daysInCountryThisYear)
      : "0"
  );
  const [declarations, setDeclarations] = useState<
    Record<DeclarationKey, boolean>
  >({
    declResidence: defaults?.declResidence ?? false,
    declVisa: defaults?.declVisa ?? false,
    declWorkingTime: defaults?.declWorkingTime ?? false,
    declDataProtection: defaults?.declDataProtection ?? false,
    declNoForbiddenActivities: defaults?.declNoForbiddenActivities ?? false,
    declReportChanges: defaults?.declReportChanges ?? false,
    declCosts: defaults?.declCosts ?? false,
  });
  const [pending, startTransition] = useTransition();

  const category = country.trim() ? classifyCountry(country) : null;

  // Arbeitstage automatisch aus dem Zeitraum berechnet, manuell korrigierbar
  const autoWorkDays =
    startDate && endDate && endDate >= startDate
      ? String(countWorkdays(startDate, endDate))
      : "";
  const workDays = workDaysManual ?? autoWorkDays;

  const validation = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate || !workDays || !category)
      return null;
    return validateWorkation({
      startDate,
      endDate,
      workDays: Number(workDays),
      daysInCountryThisYear: Number(daysInCountry) || 0,
      countryCategory: category,
      usedWorkDaysThisYear,
      yearlyLimitDays,
      consecutiveLimitDays,
    });
  }, [
    startDate,
    endDate,
    workDays,
    daysInCountry,
    category,
    usedWorkDaysThisYear,
    yearlyLimitDays,
    consecutiveLimitDays,
  ]);

  const allDeclared = Object.values(declarations).every(Boolean);
  const blocked = !allDeclared || (validation?.errors.length ?? 0) > 0;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
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

  return (
    <form action={handleSubmit} className="space-y-8 max-w-2xl">
      <section className="space-y-4">
        <h2 className="font-medium">Angaben zur Person und zum Aufenthalt</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="country">Zielland</Label>
            <Input
              id="country"
              name="country"
              required
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
            {category && (
              <Badge variant="outline">
                {category === "eu_ewr_ch"
                  ? "EU / EWR / Schweiz"
                  : "Drittstaat — gesonderte Prüfung erforderlich"}
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Aufenthaltsort (Stadt)</Label>
            <Input
              id="city"
              name="city"
              required
              defaultValue={defaults?.city ?? ""}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="accommodationAddress">
            Anschrift der Unterkunft
          </Label>
          <Input
            id="accommodationAddress"
            name="accommodationAddress"
            required
            defaultValue={defaults?.accommodationAddress ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Wird für den A1-Antrag benötigt.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="startDate">Zeitraum von</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">bis (Enddatum verbindlich)</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workDays">davon Arbeitstage</Label>
            <Input
              id="workDays"
              name="workDays"
              type="number"
              step="0.5"
              min="0.5"
              required
              value={workDays}
              onChange={(e) => setWorkDaysManual(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Automatisch aus dem Zeitraum berechnet (Mo–Fr ohne Feiertage
              NRW), manuell korrigierbar.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vacationDays">davon beantragte Urlaubstage</Label>
            <Input
              id="vacationDays"
              name="vacationDays"
              type="number"
              step="0.5"
              min="0"
              defaultValue={
                defaults?.vacationDays != null
                  ? String(defaults.vacationDays)
                  : "0"
              }
            />
            <p className="text-xs text-muted-foreground">
              Urlaubstage sind regulär über das Urlaubsmodul zu beantragen.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="timezoneAvailability">
              Zeitzone / zugesagte Erreichbarkeit
            </Label>
            <Input
              id="timezoneAvailability"
              name="timezoneAvailability"
              required
              placeholder="z. B. MEZ+6, erreichbar 9–13 Uhr dt. Zeit"
              defaultValue={defaults?.timezoneAvailability ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="daysInCountryThisYear">
              Bisherige Tage in diesem Land (lfd. Kalenderjahr)
            </Label>
            <Input
              id="daysInCountryThisYear"
              name="daysInCountryThisYear"
              type="number"
              min="0"
              value={daysInCountry}
              onChange={(e) => setDaysInCountry(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Selbstauskunft inkl. privater Aufenthalte.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="emergencyContactName">Notfallkontakt (Name)</Label>
            <Input
              id="emergencyContactName"
              name="emergencyContactName"
              required
              defaultValue={defaults?.emergencyContactName ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emergencyContactPhone">
              Notfallkontakt (Telefon)
            </Label>
            <Input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              required
              defaultValue={defaults?.emergencyContactPhone ?? ""}
            />
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="font-medium">Aufenthaltsrecht und Versicherung</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="visaType">Art des Visums / Aufenthaltstitels</Label>
            <Input
              id="visaType"
              name="visaType"
              required
              defaultValue={defaults?.visaType ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="visaValidUntil">gültig bis</Label>
            <Input
              id="visaValidUntil"
              name="visaValidUntil"
              type="date"
              defaultValue={defaults?.visaValidUntil ?? ""}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="insuranceDetails">
            Auslandskranken- und Rückholversicherung (Anbieter, Police)
          </Label>
          <Input
            id="insuranceDetails"
            name="insuranceDetails"
            required
            defaultValue={defaults?.insuranceDetails ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Nachweise sind spätestens zwei Wochen vor Antritt vorzulegen.
          </p>
        </div>
      </section>

      <Separator />

      <section className="space-y-4">
        <h2 className="font-medium">Tätigkeit im Aufenthaltszeitraum</h2>
        <div className="space-y-2">
          <Label htmlFor="plannedTasks">Geplante Aufgaben</Label>
          <Textarea
            id="plannedTasks"
            name="plannedTasks"
            required
            defaultValue={defaults?.plannedTasks ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="domesticSubstitution">
            Vertretungsregelung im Inland
          </Label>
          <Textarea
            id="domesticSubstitution"
            name="domesticSubstitution"
            required
            defaultValue={defaults?.domesticSubstitution ?? ""}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Von der Bearbeitung ausgeschlossene Projekte/Mandate
          (EU-Beschränkung) trägt die Geschäftsführung im Genehmigungsschritt
          ein.
        </p>
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="font-medium">
          Erklärungen der Mitarbeiterin / des Mitarbeiters
        </h2>
        <p className="text-sm text-muted-foreground">
          Ich erkläre, dass ich die Workation-Richtlinie der StefanAI Solutions
          GmbH gelesen habe und ihre Regelungen einhalte. Insbesondere
          bestätige ich:
        </p>
        {WORKATION_DECLARATIONS.map((d) => (
          <label key={d.key} className="flex items-start gap-3 text-sm">
            <Checkbox
              name={d.key}
              checked={declarations[d.key]}
              onCheckedChange={(v) =>
                setDeclarations((prev) => ({ ...prev, [d.key]: v === true }))
              }
              className="mt-0.5"
            />
            <span>{d.text}</span>
          </label>
        ))}
        {!allDeclared && (
          <p className="text-xs text-amber-700">
            Ohne alle sieben Erklärungen ist keine Einreichung möglich.
          </p>
        )}
      </section>

      {validation && validation.errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Einreichung nicht möglich</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {validation && validation.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Hinweise zur Prüfung</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {validation.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pending || blocked}>
        {pending ? "Wird eingereicht …" : submitLabel}
      </Button>
    </form>
  );
}
