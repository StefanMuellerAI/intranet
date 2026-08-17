"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SEMINAR_REPORT_KIND_LABELS,
  SEMINAR_REPORT_KINDS,
} from "@/lib/seminar-reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "alle";

export interface BerichteFilterValues {
  mitarbeiter: string;
  art: string;
  von: string;
  bis: string;
  sortierung: string;
}

/**
 * Filterleiste der Admin-Übersicht. Bewusst ein GET-Formular statt
 * router.push: die Auswahl landet in der URL, bleibt teilbar und wird
 * serverseitig ausgewertet. Die Select-Werte werden in versteckte Felder
 * gespiegelt, weil das Base-UI-Select keinen nativen Formularwert sendet.
 */
export function BerichteFilter({
  employees,
  values,
}: {
  employees: { id: string; name: string }[];
  values: BerichteFilterValues;
}) {
  const [mitarbeiter, setMitarbeiter] = useState(values.mitarbeiter || ALL);
  const [art, setArt] = useState(values.art || ALL);

  return (
    <form
      method="get"
      action="/berichte/alle"
      className="mb-6 grid gap-4 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <div className="space-y-2">
        <Label>Mitarbeiter/in</Label>
        <Select
          value={mitarbeiter}
          onValueChange={(value) => setMitarbeiter(String(value))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            {employees.map((employee) => (
              <SelectItem key={employee.id} value={employee.id}>
                {employee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="hidden"
          name="mitarbeiter"
          value={mitarbeiter === ALL ? "" : mitarbeiter}
        />
      </div>

      <div className="space-y-2">
        <Label>Art</Label>
        <Select value={art} onValueChange={(value) => setArt(String(value))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            {SEMINAR_REPORT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {SEMINAR_REPORT_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="art" value={art === ALL ? "" : art} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="von">Von</Label>
        <Input id="von" name="von" type="date" defaultValue={values.von} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bis">Bis</Label>
        <Input id="bis" name="bis" type="date" defaultValue={values.bis} />
      </div>

      <div className="flex items-end gap-2">
        <input type="hidden" name="sortierung" value={values.sortierung} />
        <Button type="submit">Filtern</Button>
        <Button variant="outline" render={<Link href="/berichte/alle" />}>
          Zurücksetzen
        </Button>
      </div>
    </form>
  );
}
