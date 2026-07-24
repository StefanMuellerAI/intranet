"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { generateTimesheetAction } from "@/app/(app)/faktura/export/actions";
import { mondayOfIsoWeek, addDaysISO } from "@/lib/faktura/zeitfenster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export interface CustomerOption {
  id: string;
  name: string;
  active: boolean;
}

export interface TimesheetView {
  id: string;
  docNumber: string;
  version: number;
  customerName: string;
  periodLabel: string;
  isDraft: boolean;
  stale: boolean;
  sha256Short: string;
  createdLabel: string;
  filename: string;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function ExportForm({
  customers,
  defaultMonth,
}: {
  customers: CustomerOption[];
  defaultMonth: string;
}) {
  const [pending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  // Default-Zeitraum: Kalendermonat (Entscheidung E-4)
  const [mode, setMode] = useState<"monat" | "woche" | "frei">("monat");
  const [month, setMonth] = useState(defaultMonth);
  const [weekYear, setWeekYear] = useState(String(new Date().getFullYear()));
  const [weekNo, setWeekNo] = useState("1");
  const [freeFrom, setFreeFrom] = useState("");
  const [freeTo, setFreeTo] = useState("");

  function resolvePeriod(): { fromISO: string; toISO: string } | null {
    if (mode === "monat") {
      if (!/^\d{4}-\d{2}$/.test(month)) return null;
      return { fromISO: `${month}-01`, toISO: lastDayOfMonth(month) };
    }
    if (mode === "woche") {
      const y = Number(weekYear);
      const w = Number(weekNo);
      if (!y || !w || w < 1 || w > 53) return null;
      const monday = mondayOfIsoWeek(y, w);
      return { fromISO: monday, toISO: addDaysISO(monday, 6) };
    }
    if (!freeFrom || !freeTo || freeTo < freeFrom) return null;
    return { fromISO: freeFrom, toISO: freeTo };
  }

  const period = resolvePeriod();

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Export je Kunde und Zeitraum</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Kunde</Label>
            <Select
              value={customerId}
              onValueChange={(v) => setCustomerId(v ?? "")}
              items={customers.map((c) => ({
                value: c.id,
                label: `${c.name}${c.active ? "" : " (inaktiv)"}`,
              }))}
            >
              <SelectTrigger data-testid="export-kunde">
                <SelectValue placeholder="Kunde wählen" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? "" : " (inaktiv)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Zeitraum</Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode((v ?? "monat") as typeof mode)}
              items={[
                { value: "monat", label: "Kalendermonat (Standard)" },
                { value: "woche", label: "Kalenderwoche" },
                { value: "frei", label: "Freier Zeitraum" },
              ]}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monat">Kalendermonat (Standard)</SelectItem>
                <SelectItem value="woche">Kalenderwoche</SelectItem>
                <SelectItem value="frei">Freier Zeitraum</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "monat" && (
            <div className="space-y-1">
              <Label htmlFor="export-month">Monat</Label>
              <Input
                id="export-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
          )}
          {mode === "woche" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="export-week-year">Jahr</Label>
                <Input
                  id="export-week-year"
                  type="number"
                  value={weekYear}
                  onChange={(e) => setWeekYear(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="export-week-no">KW</Label>
                <Input
                  id="export-week-no"
                  type="number"
                  min={1}
                  max={53}
                  value={weekNo}
                  onChange={(e) => setWeekNo(e.target.value)}
                />
              </div>
            </div>
          )}
          {mode === "frei" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="export-from">Von</Label>
                <Input
                  id="export-from"
                  type="date"
                  value={freeFrom}
                  onChange={(e) => setFreeFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="export-to">Bis</Label>
                <Input
                  id="export-to"
                  type="date"
                  value={freeTo}
                  onChange={(e) => setFreeTo(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!customerId || !period}
            onClick={() => {
              if (!period) return;
              window.location.href = `/api/exports/faktura?kunde=${customerId}&von=${period.fromISO}&bis=${period.toISO}`;
            }}
          >
            Rohdaten-Export (CSV)
          </Button>
          <Button
            disabled={!customerId || !period || pending}
            onClick={() => {
              if (!period) return;
              const fd = new FormData();
              fd.set("customerId", customerId);
              fd.set("fromISO", period.fromISO);
              fd.set("toISO", period.toISO);
              startTransition(async () => {
                const result = await generateTimesheetAction(fd);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                const sheet = result.data;
                toast.success(
                  sheet.isDraft
                    ? `Entwurf ${sheet.docNumber} v${sheet.version} erzeugt — Zeitraum enthält nicht freigegebene Buchungen (Wasserzeichen).`
                    : `Stundenzettel ${sheet.docNumber} v${sheet.version} erzeugt.`
                );
              });
            }}
          >
            Stundenzettel (PDF) erzeugen
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Der CSV-Export enthält alle Buchungen inkl. ausgeblendeter und
          gelöschter Positionen (gekennzeichnet). Auf dem Stundenzettel
          erscheinen nur sichtbare Buchungen aus freigegebenen Wochen;
          Zeiträume mit offenen Buchungen werden als Entwurf mit Wasserzeichen
          exportiert.
        </p>
      </CardContent>
    </Card>
  );
}

export function TimesheetList({ timesheets }: { timesheets: TimesheetView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Archivierte Stundenzettel ({timesheets.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timesheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine Stundenzettel erzeugt.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dokument</TableHead>
                <TableHead>Kunde</TableHead>
                <TableHead>Zeitraum</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead>Prüfsumme</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.docNumber} · v{t.version}
                  </TableCell>
                  <TableCell>{t.customerName}</TableCell>
                  <TableCell>{t.periodLabel}</TableCell>
                  <TableCell className="space-x-1">
                    {t.isDraft && <Badge variant="secondary">Entwurf</Badge>}
                    {t.stale && <Badge variant="destructive">veraltet</Badge>}
                    {!t.isDraft && !t.stale && <Badge>aktuell</Badge>}
                  </TableCell>
                  <TableCell>{t.createdLabel}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.sha256Short}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      render={<a href={`/api/faktura/stundenzettel/${t.id}`} />}
                    >
                      PDF herunterladen
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
