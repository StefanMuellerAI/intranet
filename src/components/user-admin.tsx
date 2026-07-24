"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_OPTIONS,
} from "@/lib/documents";
import {
  deleteEmployeeDocument,
  resendInvitation,
  setUserStatus,
  updateUserBirthday,
  updateUserSupervisors,
  updateUserVacation,
  uploadEmployeeDocuments,
} from "@/app/(app)/mitarbeitende/actions";

function CategorySelect({
  id,
  name,
  defaultValue = "arbeitsvertrag",
}: {
  id: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
    >
      {DOCUMENT_CATEGORY_OPTIONS.map((c) => (
        <option key={c} value={c}>
          {DOCUMENT_CATEGORY_LABELS[c]}
        </option>
      ))}
    </select>
  );
}

export function UserRowActions({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: string;
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>, msg: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(msg);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Fehler");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "eingeladen" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => resendInvitation(userId), "Einladung erneut versendet.")
          }
        >
          Einladung erneut senden
        </Button>
      )}
      {!isSelf && status !== "deaktiviert" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => setUserStatus(userId, "deaktiviert"),
              "User deaktiviert — Login gesperrt, Antragsdaten bleiben erhalten."
            )
          }
        >
          Deaktivieren
        </Button>
      )}
      {!isSelf && status === "deaktiviert" && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => setUserStatus(userId, "aktiv"), "User reaktiviert.")
          }
        >
          Reaktivieren
        </Button>
      )}
    </div>
  );
}

export function VacationEntitlementForm({
  userId,
  annualVacationDays,
  vacationCarryoverDays,
}: {
  userId: string;
  annualVacationDays: number;
  vacationCarryoverDays: number;
}) {
  const [pending, startTransition] = useTransition();
  const updateWithId = updateUserVacation.bind(null, userId);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          try {
            await updateWithId(fd);
            toast.success("Urlaubskonto aktualisiert.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fehler");
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <div className="space-y-1">
        <Label className="text-xs">Jahresanspruch (Tage)</Label>
        <Input
          name="annualVacationDays"
          type="number"
          step="0.5"
          min="0"
          defaultValue={annualVacationDays}
          className="w-28"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Übertrag Vorjahr (Tage)</Label>
        <Input
          name="vacationCarryoverDays"
          type="number"
          step="0.5"
          defaultValue={vacationCarryoverDays}
          className="w-28"
        />
      </div>
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        Speichern
      </Button>
    </form>
  );
}

export function BirthdayForm({
  userId,
  birthDate,
}: {
  userId: string;
  birthDate: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const updateWithId = updateUserBirthday.bind(null, userId);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          try {
            await updateWithId(fd);
            toast.success("Geburtsdatum gespeichert.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fehler");
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <div className="space-y-1">
        <Label htmlFor={`birth-date-${userId}`} className="text-xs">
          Geburtsdatum (wird im Kalender ohne Jahr angezeigt)
        </Label>
        <Input
          id={`birth-date-${userId}`}
          name="birthDate"
          type="date"
          defaultValue={birthDate ?? ""}
          className="w-40"
        />
      </div>
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        Speichern
      </Button>
    </form>
  );
}

export interface SupervisorOption {
  id: string;
  name: string;
}

function SupervisorSelect({
  id,
  name,
  defaultValue,
  options,
}: {
  id: string;
  name: string;
  defaultValue: string | null;
  options: SupervisorOption[];
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
    >
      <option value="">— keine Angabe —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function SupervisorsForm({
  userId,
  technicalSupervisorId,
  disciplinarySupervisorId,
  options,
}: {
  userId: string;
  technicalSupervisorId: string | null;
  disciplinarySupervisorId: string | null;
  options: SupervisorOption[];
}) {
  const [pending, startTransition] = useTransition();
  const updateWithId = updateUserSupervisors.bind(null, userId);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          try {
            await updateWithId(fd);
            toast.success("Vorgesetzte gespeichert.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fehler");
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      <div className="w-56 space-y-1">
        <Label htmlFor={`technical-supervisor-${userId}`} className="text-xs">
          Fachliche/r Vorgesetzte/r
        </Label>
        <SupervisorSelect
          id={`technical-supervisor-${userId}`}
          name="technicalSupervisorId"
          defaultValue={technicalSupervisorId}
          options={options}
        />
      </div>
      <div className="w-56 space-y-1">
        <Label
          htmlFor={`disciplinary-supervisor-${userId}`}
          className="text-xs"
        >
          Disziplinarische/r Vorgesetzte/r
        </Label>
        <SupervisorSelect
          id={`disciplinary-supervisor-${userId}`}
          name="disciplinarySupervisorId"
          defaultValue={disciplinarySupervisorId}
          options={options}
        />
      </div>
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        Speichern
      </Button>
    </form>
  );
}

export interface EmployeeDocumentItem {
  id: string;
  category: string;
  categoryLabel: string;
  title: string | null;
  filename: string;
  createdAtLabel: string;
}

export function EmployeeDocumentsPanel({
  userId,
  documents,
}: {
  userId: string;
  documents: EmployeeDocumentItem[];
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadWithId = uploadEmployeeDocuments.bind(null, userId);

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        Dokumente ({documents.length})
      </p>

      {documents.length > 0 && (
        <ul className="mb-3 space-y-1">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <a
                href={`/api/dokumente/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-primary"
              >
                {doc.title ?? doc.filename}
              </a>
              <span className="text-xs text-muted-foreground">
                {doc.categoryLabel} · {doc.createdAtLabel}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={pending}
                title="Dokument endgültig löschen"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Dokument "${doc.filename}" endgültig löschen?`
                    )
                  )
                    return;
                  startTransition(async () => {
                    try {
                      await deleteEmployeeDocument(doc.id);
                      toast.success("Dokument gelöscht.");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Fehler"
                      );
                    }
                  });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            try {
              await uploadWithId(fd);
              formRef.current?.reset();
              toast.success("Dokument(e) verschlüsselt gespeichert.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Fehler");
            }
          })
        }
        className="grid items-end gap-2 sm:grid-cols-4"
      >
        <div className="space-y-1">
          <Label htmlFor={`doc-files-${userId}`} className="text-xs">
            Datei(en) — PDF/JPG/PNG, max. 10 MB
          </Label>
          <Input
            id={`doc-files-${userId}`}
            name="documents"
            type="file"
            multiple
            required
            accept="application/pdf,image/jpeg,image/png"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`doc-category-${userId}`} className="text-xs">
            Kategorie
          </Label>
          <CategorySelect id={`doc-category-${userId}`} name="category" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`doc-title-${userId}`} className="text-xs">
            Titel (optional)
          </Label>
          <Input
            id={`doc-title-${userId}`}
            name="title"
            placeholder="z. B. Arbeitsvertrag vom 01.01.2026"
          />
        </div>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : "Hochladen"}
        </Button>
      </form>
    </div>
  );
}

export function InviteForm({
  action,
  defaultVacationDays,
  emailDomain,
}: {
  action: (formData: FormData) => Promise<void>;
  defaultVacationDays: number;
  emailDomain: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          try {
            await action(fd);
            toast.success("Einladung versendet.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fehler");
          }
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="space-y-1">
        <Label htmlFor="firstName">Vorname</Label>
        <Input id="firstName" name="firstName" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lastName">Nachname</Label>
        <Input id="lastName" name="lastName" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">E-Mail-Adresse (@{emailDomain})</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder={`vorname.nachname@${emailDomain}`}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="annualVacationDays">
          Jahresurlaubsanspruch (Pflichtfeld)
        </Label>
        <Input
          id="annualVacationDays"
          name="annualVacationDays"
          type="number"
          step="0.5"
          min="0.5"
          required
          defaultValue={defaultVacationDays}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="invite-birth-date">Geburtsdatum (optional)</Label>
        <Input id="invite-birth-date" name="birthDate" type="date" />
        <p className="text-xs text-muted-foreground">
          Wird im Kalender als Geburtstag angezeigt — ohne Geburtsjahr.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="invite-documents">
          Arbeitsvertrag &amp; weitere Dokumente (optional)
        </Label>
        <Input
          id="invite-documents"
          name="documents"
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
        />
        <p className="text-xs text-muted-foreground">
          PDF/JPG/PNG, max. 10 MB pro Datei — wird verschlüsselt gespeichert.
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="invite-document-category">Dokument-Kategorie</Label>
        <CategorySelect
          id="invite-document-category"
          name="documentCategory"
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Wird versendet …" : "Einladen"}
        </Button>
      </div>
    </form>
  );
}
