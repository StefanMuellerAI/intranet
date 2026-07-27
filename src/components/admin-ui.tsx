"use client";

import { useState, useTransition } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Gemeinsame Bausteine der Admin-Oberflächen (Inhalte, Mitarbeitende, …):
// Tabelle mit Aktionsspalte, Dialoge für Anlegen/Bearbeiten/Löschen.
// ---------------------------------------------------------------------------

/**
 * Führt eine Server Action aus, meldet das Ergebnis als Toast und liefert
 * `true` zurück, wenn sie ohne Fehler durchgelaufen ist. Dialoge nutzen den
 * Rückgabewert, um sich nur bei Erfolg zu schließen.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>, msg?: string) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        try {
          await fn();
          if (msg) toast.success(msg);
          resolve(true);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Fehler");
          resolve(false);
        }
      });
    });
  return { pending, run };
}

/** Dialog mit genau einem Formular, das eine Server Action auslöst. */
export function FormDialog({
  trigger,
  triggerLabel,
  title,
  description,
  action,
  successMessage,
  submitLabel,
  contentClassName = "sm:max-w-lg",
  children,
}: {
  trigger: React.ReactElement;
  triggerLabel: React.ReactNode;
  title: string;
  description?: string;
  action: (formData: FormData) => Promise<void>;
  successMessage: string;
  submitLabel: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          action={async (formData) => {
            if (await run(() => action(formData), successMessage)) setOpen(false);
          }}
          aria-busy={pending}
          className="grid gap-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">{children}</div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Abbrechen
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Wird gespeichert …" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog-Hülle ohne eigenes Formular — für Inhalte, die mehrere voneinander
 * unabhängige Formulare bündeln (jedes speichert für sich).
 */
export function PanelDialog({
  trigger,
  triggerLabel,
  title,
  description,
  contentClassName = "sm:max-w-xl",
  children,
}: {
  trigger: React.ReactElement;
  triggerLabel: React.ReactNode;
  title: string;
  description?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Schließen
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bestätigungsdialog für endgültige Löschvorgänge. */
export function DeleteDialog({
  entityLabel,
  itemTitle,
  action,
  successMessage,
  trigger,
}: {
  entityLabel: string;
  itemTitle: string;
  action: () => Promise<unknown>;
  successMessage: string;
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Löschen"
              title="Löschen"
              className="text-muted-foreground hover:text-destructive"
            />
          )
        }
      >
        <Trash2 className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entityLabel} löschen?</DialogTitle>
          <DialogDescription>
            „{itemTitle}“ wird endgültig entfernt. Dieser Schritt lässt sich
            nicht rückgängig machen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Abbrechen
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (await run(action, successMessage)) setOpen(false);
            }}
          >
            {pending ? "Wird gelöscht …" : "Endgültig löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bestätigungsdialog für Aktionen, die nicht löschen, aber eine bewusste
 * Entscheidung brauchen (z. B. Login sperren).
 */
export function ConfirmDialog({
  trigger,
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel,
  action,
  successMessage,
  variant = "default",
}: {
  trigger: React.ReactElement;
  triggerLabel: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  action: () => Promise<unknown>;
  successMessage: string;
  variant?: "default" | "destructive";
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{triggerLabel}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Abbrechen
          </DialogClose>
          <Button
            variant={variant}
            disabled={pending}
            onClick={async () => {
              if (await run(action, successMessage)) setOpen(false);
            }}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Auge-Button, der einen Eintrag ein- oder ausblendet. */
export function VisibilityToggle({
  active,
  action,
  hiddenMessage,
  shownMessage,
}: {
  active: boolean;
  action: () => Promise<unknown>;
  hiddenMessage: string;
  shownMessage: string;
}) {
  const { pending, run } = useAction();
  const label = active ? "Ausblenden" : "Einblenden";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
      onClick={() => run(action, active ? hiddenMessage : shownMessage)}
    >
      {active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );
}

/** Badge für die Sichtbarkeit eines Eintrags (nicht für Antragsstatus). */
export function VisibilityBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "secondary" : "outline"}>
      {active ? "sichtbar" : "ausgeblendet"}
    </Badge>
  );
}

export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-0.5">{children}</div>
  );
}

/** Icon-Button, der in einer Tabellenzeile einen Dialog öffnet. */
export function iconTrigger(label: string) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground"
    />
  );
}

/** Icon-Button, der in einer Tabellenzeile den Bearbeiten-Dialog öffnet. */
export const editTrigger = iconTrigger("Bearbeiten");

/** Button unterhalb einer Tabelle, der den Anlegen-Dialog öffnet. */
export const createTrigger = <Button variant="outline" size="sm" />;

/**
 * Tabellenabschnitt mit Hinweistext, gerahmter Tabelle, Leerzustand und
 * Anlege-Button darunter.
 */
export function TabSection({
  hint,
  isEmpty,
  emptyLabel,
  columns,
  createAction,
  note,
  children,
}: {
  hint: string;
  isEmpty: boolean;
  emptyLabel: string;
  columns: React.ReactNode;
  createAction: React.ReactNode;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{hint}</p>

      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        {isEmpty ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {columns}
              </TableRow>
            </TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">{createAction}</div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
