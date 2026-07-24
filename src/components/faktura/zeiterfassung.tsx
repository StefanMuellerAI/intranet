"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createEntryAction,
  deleteEntryAction,
  updateEntryAction,
} from "@/app/(app)/faktura/actions";
import type { SaveEntryResult } from "@/lib/faktura/buchungen";
import {
  QUARTER_HOURS_PATTERN,
  QUARTER_HOURS_TITLE,
} from "@/lib/form-patterns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

export interface ProjectOption {
  id: string;
  label: string;
  validFrom: string | null;
  validTo: string | null;
  hasLimit: boolean;
}

export interface EntryView {
  id: string;
  projectId: string;
  projectLabel: string;
  entryDate: string;
  durationHours: string;
  description: string;
  status: "offen" | "freigegeben";
  visibleOnTimesheet: boolean;
  overbooked: boolean;
  editable: boolean;
}

export interface DayView {
  dateISO: string;
  label: string;
  entries: EntryView[];
  totalHours: string;
}

function EntryForm({
  projects,
  defaultDate,
  entry,
  onDone,
}: {
  projects: ProjectOption[];
  defaultDate: string;
  entry?: EntryView;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(entry?.projectId ?? "");

  const submit = (formData: FormData, confirm: boolean) => {
    formData.set("projectId", projectId);
    formData.set("confirmWarnings", confirm ? "true" : "false");
    startTransition(async () => {
      const result: SaveEntryResult = entry
        ? await updateEntryAction(entry.id, formData)
        : await createEntryAction(formData);
      if (result.ok) {
        toast.success(entry ? "Buchung aktualisiert." : "Buchung gespeichert.");
        setWarnings([]);
        onDone();
      } else if ("error" in result) {
        toast.error(result.error);
      } else {
        setWarnings(result.warnings);
      }
    });
  };

  return (
    <form
      className="grid gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget), warnings.length > 0);
      }}
    >
      <div className="space-y-1">
        <Label>Kunde – Projekt</Label>
        <Select
          value={projectId}
          onValueChange={(v) => setProjectId(v ?? "")}
          items={projects.map((p) => ({ value: p.id, label: p.label }))}
        >
          <SelectTrigger data-testid="projekt-auswahl">
            <SelectValue placeholder="Projekt wählen" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="entry-date">Buchungsdatum</Label>
        <Input
          id="entry-date"
          name="entryDate"
          type="date"
          required
          defaultValue={entry?.entryDate ?? defaultDate}
        />
        <p className="text-xs text-muted-foreground">
          Buchbar sind nur der aktuelle Tag und zurückliegende Werktage der
          laufenden Kalenderwoche (Mo–Fr).
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="entry-duration">Dauer in Stunden (0,25er-Raster)</Label>
        <Input
          id="entry-duration"
          name="durationHours"
          inputMode="decimal"
          pattern={QUARTER_HOURS_PATTERN}
          title={QUARTER_HOURS_TITLE}
          required
          placeholder="z. B. 1,25"
          defaultValue={entry?.durationHours ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="entry-description">
          Tätigkeitsbeschreibung (Pflicht, erscheint auf dem Stundenzettel)
        </Label>
        <Textarea
          id="entry-description"
          name="description"
          required
          rows={3}
          defaultValue={entry?.description ?? ""}
        />
      </div>

      {warnings.length > 0 && (
        <Alert>
          <AlertTitle>Hinweis vor dem Speichern</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {warnings.length > 0
            ? "Trotzdem buchen"
            : entry
              ? "Änderungen speichern"
              : "Buchung speichern"}
        </Button>
      </div>
    </form>
  );
}

function EntryDialog({
  projects,
  defaultDate,
  entry,
  trigger,
  triggerLabel,
  title,
}: {
  projects: ProjectOption[];
  defaultDate: string;
  entry?: EntryView;
  trigger: React.ReactElement<Record<string, unknown>>;
  triggerLabel: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <EntryForm
          projects={projects}
          defaultDate={defaultDate}
          entry={entry}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!confirm("Buchung wirklich löschen?")) return;
        startTransition(async () => {
          const result = await deleteEntryAction(id);
          if (result.ok) toast.success("Buchung gelöscht.");
          else toast.error(result.error);
        });
      }}
    >
      Löschen
    </Button>
  );
}

export function Zeiterfassung({
  days,
  weekTotalHours,
  weekApproved,
  bookingOpen,
  defaultDate,
  projects,
}: {
  days: DayView[];
  weekTotalHours: string;
  weekApproved: boolean;
  /** Buchungsfenster der laufenden Woche offen (Werktag, Woche nicht freigegeben) */
  bookingOpen: boolean;
  defaultDate: string;
  projects: ProjectOption[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {weekApproved ? (
          <Badge>Woche freigegeben — Buchungen schreibgeschützt</Badge>
        ) : (
          <Badge variant="outline">Woche offen</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          Wochensumme: <strong>{weekTotalHours} h</strong>
        </span>
        {projects.length > 0 && (
          <EntryDialog
            projects={projects}
            defaultDate={defaultDate}
            title="Neue Zeitbuchung"
            trigger={<Button data-testid="neue-buchung" />}
            triggerLabel="Zeit buchen"
          />
        )}
        {!bookingOpen && (
          <span className="text-sm text-muted-foreground">
            Das Buchungsfenster für diese Woche ist geschlossen.
          </span>
        )}
      </div>

      {days.map((day) => (
        <Card key={day.dateISO}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>{day.label}</span>
              <span className="text-muted-foreground">
                Tagessumme: {day.totalHours} h
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {day.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Buchungen.</p>
            ) : (
              <ul className="space-y-2">
                {day.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{entry.projectLabel}</p>
                      <p className="text-muted-foreground">
                        {entry.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.overbooked && (
                        <Badge variant="destructive">Überbuchung</Badge>
                      )}
                      {!entry.visibleOnTimesheet && (
                        <Badge variant="secondary">
                          nicht im Stundenzettel
                        </Badge>
                      )}
                      <Badge
                        variant={
                          entry.status === "freigegeben" ? "default" : "outline"
                        }
                      >
                        {entry.status}
                      </Badge>
                      <span className="font-semibold">
                        {entry.durationHours} h
                      </span>
                      {entry.editable && (
                        <>
                          <EntryDialog
                            projects={projects}
                            defaultDate={entry.entryDate}
                            entry={entry}
                            title="Buchung bearbeiten"
                            trigger={<Button variant="ghost" size="sm" />}
                            triggerLabel="Bearbeiten"
                          />
                          <DeleteButton id={entry.id} />
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
