"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { countVacationDays } from "@/lib/dates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface AbsenceRange {
  name: string;
  type: string;
  from: string;
  to: string;
}

export interface VacationFormDefaults {
  startDate?: string;
  endDate?: string;
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  substituteUserId?: string;
  substituteText?: string;
  note?: string;
}

export function VacationForm({
  action,
  users,
  remainingDays,
  remainingByYear,
  minDate,
  absences,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  users: { id: string; name: string }[];
  remainingDays: number;
  /** Resturlaub je Kalenderjahr — der Hinweis nutzt das Jahr des Startdatums */
  remainingByYear?: Record<string, number>;
  /** Frühestes wählbares Datum (Eintrittsdatum) */
  minDate?: string;
  absences: AbsenceRange[];
  defaults?: VacationFormDefaults;
  submitLabel: string;
}) {
  const [startDate, setStartDate] = useState(defaults?.startDate ?? "");
  const [endDate, setEndDate] = useState(defaults?.endDate ?? "");
  const [halfDayStart, setHalfDayStart] = useState(
    defaults?.halfDayStart ?? false
  );
  const [halfDayEnd, setHalfDayEnd] = useState(defaults?.halfDayEnd ?? false);
  const [substituteUserId, setSubstituteUserId] = useState(
    defaults?.substituteUserId ?? ""
  );
  const [pending, startTransition] = useTransition();

  const days = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return null;
    return countVacationDays(startDate, endDate, halfDayStart, halfDayEnd);
  }, [startDate, endDate, halfDayStart, halfDayEnd]);

  const overlaps = useMemo(() => {
    if (!startDate || !endDate) return [];
    return absences.filter((a) => a.from <= endDate && a.to >= startDate);
  }, [absences, startDate, endDate]);

  // Maßgeblich ist der Anspruch des Jahres, in dem der Urlaub beginnt
  const remainingForYear = useMemo(() => {
    const year = startDate.slice(0, 4);
    return remainingByYear?.[year] ?? remainingDays;
  }, [remainingByYear, remainingDays, startDate]);

  const remainingAfter = days !== null ? remainingForYear - days : null;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await action(formData);
      } catch (err) {
        if (
          err instanceof Error &&
          !err.message.includes("NEXT_REDIRECT")
        ) {
          toast.error(err.message);
          return;
        }
        throw err;
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6 max-w-xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startDate">Von</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            required
            min={minDate}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              name="halfDayStart"
              checked={halfDayStart}
              onCheckedChange={(v) => setHalfDayStart(v === true)}
            />
            Erster Tag nur halber Tag
          </label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">Bis</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            required
            min={minDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              name="halfDayEnd"
              checked={halfDayEnd}
              onCheckedChange={(v) => setHalfDayEnd(v === true)}
            />
            Letzter Tag nur halber Tag
          </label>
        </div>
      </div>

      {days !== null && (
        <Alert>
          <AlertTitle>
            {days} Urlaubstag{days === 1 ? "" : "e"} (ohne Wochenenden und
            Feiertage NRW)
          </AlertTitle>
          <AlertDescription>
            {remainingAfter !== null && remainingAfter >= 0
              ? `Verbleibender Resturlaub nach diesem Antrag: ${remainingAfter} Tage.`
              : `Achtung: Dieser Antrag übersteigt Ihren Resturlaub von ${remainingForYear} Tagen.`}
          </AlertDescription>
        </Alert>
      )}

      {overlaps.length > 0 && (
        <Alert>
          <AlertTitle>Überschneidung mit Abwesenheiten anderer</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {overlaps.map((o, i) => (
                <li key={i}>
                  {o.name}: {o.type} ({o.from} bis {o.to})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label>Vertretung während der Abwesenheit</Label>
        <Select
          value={substituteUserId || "keine"}
          onValueChange={(v) =>
            setSubstituteUserId(!v || v === "keine" ? "" : String(v))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Vertretung wählen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="keine">Keine / Freitext</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="substituteUserId" value={substituteUserId} />
        <Input
          name="substituteText"
          placeholder="Alternativ: Vertretung als Freitext"
          defaultValue={defaults?.substituteText ?? ""}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">Bemerkung (optional)</Label>
        <Textarea id="note" name="note" defaultValue={defaults?.note ?? ""} />
      </div>

      <Button type="submit" disabled={pending || days === null || days <= 0}>
        {pending ? "Wird eingereicht …" : submitLabel}
      </Button>
    </form>
  );
}
