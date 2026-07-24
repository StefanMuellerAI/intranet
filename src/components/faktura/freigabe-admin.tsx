"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  adminCreateEntryAction,
  adminDeleteEntryAction,
  adminUpdateEntryAction,
  approveWeekAction,
  getEntryHistoryAction,
  revokeWeekAction,
  setEntryVisibilityAction,
  type EntryHistoryItem,
} from "@/app/(app)/faktura/freigabe/actions";
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

export interface AdminProjectOption {
  id: string;
  label: string;
}

export interface EmployeeOption {
  id: string;
  name: string;
}

export interface FreigabeEntryView {
  id: string;
  userId: string;
  userName: string;
  projectId: string;
  entryDate: string;
  dateLabel: string;
  durationHours: string;
  description: string;
  status: "offen" | "freigegeben";
  visibleOnTimesheet: boolean;
  overbooked: boolean;
}

export interface FreigabeProjectView {
  projectId: string;
  label: string;
  totalHours: string;
  limitHours: string | null;
  entries: FreigabeEntryView[];
}

export interface FreigabeCustomerView {
  customerId: string;
  customerName: string;
  totalHours: string;
  projects: FreigabeProjectView[];
}

export interface FreigabeWeekView {
  isoYear: number;
  isoWeek: number;
  weekLabel: string;
  rangeLabel: string;
  closed: boolean;
  empty: boolean;
  approvalStatus: "offen" | "freigegeben" | "widerrufen" | null;
  approvedInfo: string | null;
  totalHours: string;
  overbookedCount: number;
}

function useRun() {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>, msg?: string) =>
    startTransition(async () => {
      try {
        await fn();
        if (msg) toast.success(msg);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Fehler");
      }
    });
  return { pending, run };
}

function AdminEntryDialog({
  projects,
  employees,
  entry,
  weekApproved,
  trigger,
  triggerLabel,
  title,
}: {
  projects: AdminProjectOption[];
  employees: EmployeeOption[];
  entry?: FreigabeEntryView;
  weekApproved: boolean;
  trigger: React.ReactElement<Record<string, unknown>>;
  triggerLabel: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const [projectId, setProjectId] = useState(entry?.projectId ?? "");
  const [userId, setUserId] = useState(entry?.userId ?? "");
  const reasonRequired =
    weekApproved || entry?.status === "freigegeben";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Beim Öffnen auf die Ausgangswerte zurücksetzen — der Dialog bleibt
        // zwischen zwei Öffnungen gemountet und behielte sonst die Auswahl.
        if (o) {
          setProjectId(entry?.projectId ?? "");
          setUserId(entry?.userId ?? "");
        }
      }}
    >
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          aria-busy={pending}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("projectId", projectId);
            if (!entry) fd.set("userId", userId);
            run(
              () =>
                entry
                  ? adminUpdateEntryAction(entry.id, fd)
                  : adminCreateEntryAction(fd),
              entry ? "Buchung angepasst." : "Buchung angelegt."
            );
            setOpen(false);
          }}
        >
          {!entry && (
            <div className="space-y-1">
              <Label>Mitarbeiter/in</Label>
              <Select
                value={userId}
                onValueChange={(v) => setUserId(v ?? "")}
                items={employees.map((u) => ({ value: u.id, label: u.name }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Mitarbeiter/in wählen" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label>Kunde – Projekt</Label>
            <Select
              value={projectId}
              onValueChange={(v) => setProjectId(v ?? "")}
              items={projects.map((p) => ({ value: p.id, label: p.label }))}
            >
              <SelectTrigger>
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
            <Label htmlFor="admin-entry-date">Buchungsdatum (Werktag)</Label>
            <Input
              id="admin-entry-date"
              name="entryDate"
              type="date"
              required
              defaultValue={entry?.entryDate ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="admin-entry-duration">
              Dauer in Stunden (0,25er-Raster)
            </Label>
            <Input
              id="admin-entry-duration"
              name="durationHours"
              inputMode="decimal"
              required
              defaultValue={entry?.durationHours ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="admin-entry-description">
              Tätigkeitsbeschreibung
            </Label>
            <Textarea
              id="admin-entry-description"
              name="description"
              required
              rows={3}
              defaultValue={entry?.description ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="admin-entry-reason">
              Begründung{" "}
              {reasonRequired
                ? "(Pflicht — Woche/Buchung bereits freigegeben)"
                : "(optional)"}
            </Label>
            <Textarea
              id="admin-entry-reason"
              name="reason"
              rows={2}
              required={reasonRequired}
            />
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              Speichern
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ entryId }: { entryId: string }) {
  const [items, setItems] = useState<EntryHistoryItem[] | null>(null);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open)
          getEntryHistoryAction(entryId)
            .then(setItems)
            .catch(() => toast.error("Historie konnte nicht geladen werden."));
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Historie
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Historie der Buchung</DialogTitle>
        </DialogHeader>
        {items === null ? (
          <p className="text-sm text-muted-foreground">Lädt…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Einträge.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {items.map((item, i) => (
              <li key={i} className="rounded-md border p-2">
                <p className="font-medium">
                  {item.action} — {item.actorLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString("de-DE", {
                    timeZone: "Europe/Berlin",
                  })}
                </p>
                {item.details && (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {item.details}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteEntryButton({
  entry,
}: {
  entry: FreigabeEntryView;
}) {
  const { pending, run } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason =
          entry.status === "freigegeben"
            ? prompt(
                "Begründung für die Löschung (Pflicht, Buchung ist freigegeben):"
              )
            : prompt("Begründung (optional):") ?? "";
        if (entry.status === "freigegeben" && !reason?.trim()) {
          if (reason !== null) toast.error("Begründung erforderlich.");
          return;
        }
        if (reason === null) return;
        run(
          () => adminDeleteEntryAction(entry.id, reason ?? ""),
          "Buchung gelöscht (Soft-Delete)."
        );
      }}
    >
      Löschen
    </Button>
  );
}

export function FreigabeAdmin({
  week,
  customers,
  projects,
  employees,
}: {
  week: FreigabeWeekView;
  customers: FreigabeCustomerView[];
  projects: AdminProjectOption[];
  employees: EmployeeOption[];
}) {
  const { pending, run } = useRun();
  const weekApproved = week.approvalStatus === "freigegeben";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {week.weekLabel} ({week.rangeLabel})
            {week.empty ? (
              <Badge variant="secondary">leer — keine Buchungen</Badge>
            ) : weekApproved ? (
              <Badge>freigegeben</Badge>
            ) : week.approvalStatus === "widerrufen" ? (
              <Badge variant="destructive">Freigabe widerrufen</Badge>
            ) : (
              <Badge variant="outline">offen</Badge>
            )}
            {week.overbookedCount > 0 && (
              <Badge variant="destructive">
                {week.overbookedCount} Überbuchung(en)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Wochensumme: <strong>{week.totalHours} h</strong>
            {week.approvedInfo ? ` · ${week.approvedInfo}` : ""}
          </p>
          {!week.closed && !week.empty && (
            <Alert>
              <AlertTitle>Woche noch nicht abgeschlossen</AlertTitle>
              <AlertDescription>
                Freigebbar sind ausschließlich abgeschlossene Wochen (ab
                Samstag 00:00 Uhr).
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {!weekApproved && !week.empty && (
              <Button
                disabled={pending || !week.closed}
                onClick={() =>
                  run(
                    () => approveWeekAction(week.isoYear, week.isoWeek),
                    "Woche freigegeben — alle Buchungen sind jetzt schreibgeschützt."
                  )
                }
              >
                Woche freigeben
              </Button>
            )}
            {weekApproved && (
              <Dialog>
                <DialogTrigger render={<Button variant="destructive" />}>
                  Freigabe widerrufen
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Freigabe widerrufen</DialogTitle>
                  </DialogHeader>
                  <form
                    className="grid gap-3"
                    action={(fd) =>
                      run(() => revokeWeekAction(fd), "Freigabe widerrufen.")
                    }
                  >
                    <input type="hidden" name="isoYear" value={week.isoYear} />
                    <input type="hidden" name="isoWeek" value={week.isoWeek} />
                    <div className="space-y-1">
                      <Label htmlFor="revoke-reason">
                        Begründung (Pflicht)
                      </Label>
                      <Textarea
                        id="revoke-reason"
                        name="reason"
                        required
                        rows={3}
                      />
                    </div>
                    <div>
                      <Button type="submit" variant="destructive">
                        Widerrufen
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
            <AdminEntryDialog
              projects={projects}
              employees={employees}
              weekApproved={weekApproved}
              title="Buchung für Mitarbeiter/in anlegen"
              trigger={<Button variant="outline" />}
              triggerLabel="Buchung anlegen"
            />
          </div>
        </CardContent>
      </Card>

      {week.empty ? (
        <p className="text-sm text-muted-foreground">
          Keine Buchungen in dieser Woche — keine Freigabe erforderlich.
        </p>
      ) : (
        customers.map((customer) => (
          <Card key={customer.customerId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{customer.customerName}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {customer.totalHours} h
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {customer.projects.map((project) => (
                <div key={project.projectId}>
                  <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                    {project.label}
                    <span className="text-muted-foreground">
                      {project.totalHours} h
                      {project.limitHours
                        ? ` (Monatslimit: ${project.limitHours} h)`
                        : ""}
                    </span>
                  </p>
                  <ul className="space-y-2">
                    {project.entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                        data-overbooked={entry.overbooked || undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {entry.dateLabel} · {entry.userName}
                          </p>
                          <p className="text-muted-foreground">
                            {entry.description}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {entry.overbooked && (
                            <Badge variant="destructive">Überbuchung</Badge>
                          )}
                          {!entry.visibleOnTimesheet && (
                            <Badge variant="secondary">ausgeblendet</Badge>
                          )}
                          <Badge
                            variant={
                              entry.status === "freigegeben"
                                ? "default"
                                : "outline"
                            }
                          >
                            {entry.status}
                          </Badge>
                          <span className="font-semibold">
                            {entry.durationHours} h
                          </span>
                          <AdminEntryDialog
                            projects={projects}
                            employees={employees}
                            entry={entry}
                            weekApproved={weekApproved}
                            title="Buchung anpassen"
                            trigger={<Button variant="ghost" size="sm" />}
                            triggerLabel="Bearbeiten"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () =>
                                  setEntryVisibilityAction(
                                    entry.id,
                                    !entry.visibleOnTimesheet
                                  ),
                                entry.visibleOnTimesheet
                                  ? "Buchung für den Stundenzettel ausgeblendet."
                                  : "Buchung wieder eingeblendet."
                              )
                            }
                          >
                            {entry.visibleOnTimesheet
                              ? "Ausblenden"
                              : "Einblenden"}
                          </Button>
                          <DeleteEntryButton entry={entry} />
                          <HistoryDialog entryId={entry.id} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export function WeekNav({
  weeks,
  activeYear,
  activeWeek,
}: {
  weeks: {
    isoYear: number;
    isoWeek: number;
    label: string;
    status: string;
    overbookedCount: number;
  }[];
  activeYear: number;
  activeWeek: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {weeks.map((w) => {
        const active = w.isoYear === activeYear && w.isoWeek === activeWeek;
        return (
          <Button
            key={`${w.isoYear}-${w.isoWeek}`}
            variant={active ? "default" : "outline"}
            size="sm"
            render={
              <Link
                href={`/faktura/freigabe?jahr=${w.isoYear}&kw=${w.isoWeek}`}
              />
            }
          >
            {w.label}
            <span className="text-xs opacity-70">({w.status})</span>
            {w.overbookedCount > 0 && (
              <Badge variant="destructive" className="ml-1">
                {w.overbookedCount}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}
