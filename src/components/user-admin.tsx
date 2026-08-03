"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Mail, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import {
  ConfirmDialog,
  DeleteDialog,
  FormDialog,
  PanelDialog,
  RowActions,
  TabSection,
  createTrigger,
  editTrigger,
  iconTrigger,
  useAction,
} from "@/components/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_OPTIONS,
} from "@/lib/documents";
import {
  deleteEmployeeDocument,
  inviteUser,
  resendInvitation,
  setUserStatus,
  updateUserBirthday,
  updateUserEntry,
  updateUserSupervisors,
  updateUserVacation,
  uploadEmployeeDocuments,
} from "@/app/(app)/mitarbeitende/actions";

export interface SupervisorOption {
  id: string;
  name: string;
}

export interface EmployeeDocumentItem {
  id: string;
  category: string;
  categoryLabel: string;
  title: string | null;
  filename: string;
  createdAtLabel: string;
}

export type UserStatus = "eingeladen" | "aktiv" | "deaktiviert";

export type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  isAdmin: boolean;
  isSelf: boolean;
  isManagingDirector: boolean;
  annualVacationDays: number;
  vacationCarryoverDays: number;
  entryDate: string | null;
  entryYearVacationDays: number | null;
  /** Eintrittsdatum als deutsches Datum oder „—“ */
  entryLabel: string;
  /** true, solange das Eintrittsdatum in der Zukunft liegt */
  entryPending: boolean;
  birthDate: string | null;
  birthdayLabel: string;
  technicalSupervisorId: string | null;
  disciplinarySupervisorId: string | null;
  supervisorsLabel: string;
  documents: EmployeeDocumentItem[];
};

const STATUS_LABELS: Record<UserStatus, string> = {
  eingeladen: "Eingeladen",
  aktiv: "Aktiv",
  deaktiviert: "Deaktiviert",
};

const STATUS_CLASSES: Record<UserStatus, string> = {
  aktiv: "bg-green-100 text-green-800 border-green-200",
  eingeladen: "bg-blue-100 text-blue-800 border-blue-200",
  deaktiviert: "bg-gray-100 text-gray-600 border-gray-200",
};

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

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

function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASSES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** Abschnitt innerhalb eines Dialogs — jeder speichert für sich. */
function DialogSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** Icon-Button in der Aktionsspalte, der eine Server Action direkt auslöst. */
function IconAction({
  label,
  action,
  successMessage,
  children,
}: {
  label: string;
  action: () => Promise<unknown>;
  successMessage: string;
  children: React.ReactNode;
}) {
  const { pending, run } = useAction();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={pending}
      className="text-muted-foreground hover:text-foreground"
      onClick={() => run(action, successMessage)}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Formulare — jedes ruft genau eine Server Action und schreibt einen
// eigenen Audit-Eintrag, deshalb behält jedes seinen Speichern-Button.
// ---------------------------------------------------------------------------

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
        <Label htmlFor={`annual-vacation-${userId}`} className="text-xs">
          Jahresanspruch (Tage)
        </Label>
        <Input
          id={`annual-vacation-${userId}`}
          name="annualVacationDays"
          type="number"
          step="0.5"
          min="0"
          defaultValue={annualVacationDays}
          className="w-28"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`vacation-carryover-${userId}`} className="text-xs">
          Übertrag Vorjahr (Tage)
        </Label>
        <Input
          id={`vacation-carryover-${userId}`}
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

export function EntryForm({
  userId,
  entryDate,
  entryYearVacationDays,
}: {
  userId: string;
  entryDate: string | null;
  entryYearVacationDays: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const updateWithId = updateUserEntry.bind(null, userId);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          try {
            await updateWithId(fd);
            toast.success("Eintritt gespeichert.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Fehler");
          }
        })
      }
      className="space-y-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`entry-date-${userId}`} className="text-xs">
            Eintrittsdatum
          </Label>
          <Input
            id={`entry-date-${userId}`}
            name="entryDate"
            type="date"
            defaultValue={entryDate ?? ""}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor={`entry-year-vacation-${userId}`}
            className="text-xs"
          >
            Resturlaub im Eintrittsjahr (Tage)
          </Label>
          <Input
            id={`entry-year-vacation-${userId}`}
            name="entryYearVacationDays"
            type="number"
            step="1"
            min="0"
            defaultValue={entryYearVacationDays ?? ""}
            className="w-28"
          />
        </div>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>
          Speichern
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Der Zugang ist erst ab dem Eintrittsdatum freigeschaltet. Im
        Eintrittsjahr gilt ausschließlich der hier hinterlegte Resturlaub, ab
        dem Folgejahr der Jahresanspruch. Ohne Eintrittsdatum gilt in jedem Jahr
        der Jahresanspruch.
      </p>
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

export function SupervisorsForm({
  userId,
  technicalSupervisorId,
  disciplinarySupervisorId,
  isManagingDirector,
  options,
}: {
  userId: string;
  technicalSupervisorId: string | null;
  disciplinarySupervisorId: string | null;
  isManagingDirector: boolean;
  options: SupervisorOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [managingDirector, setManagingDirector] = useState(isManagingDirector);
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
      className="flex flex-wrap items-end gap-x-4 gap-y-2"
    >
      <div className="flex h-9 items-center gap-2">
        <Checkbox
          id={`managing-director-${userId}`}
          name="isManagingDirector"
          checked={managingDirector}
          onCheckedChange={(checked) => setManagingDirector(checked === true)}
        />
        <Label htmlFor={`managing-director-${userId}`} className="text-xs">
          Geschäftsführung
        </Label>
      </div>
      {managingDirector ? (
        <p className="flex h-9 items-center text-sm text-muted-foreground">
          Geschäftsführung — keine Vorgesetzten-Zuordnung.
        </p>
      ) : (
        <>
          <div className="w-56 space-y-1">
            <Label
              htmlFor={`technical-supervisor-${userId}`}
              className="text-xs"
            >
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
        </>
      )}
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        Speichern
      </Button>
    </form>
  );
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
    <div className="space-y-4">
      {documents.length > 0 ? (
        <ul className="space-y-1">
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
              <DeleteDialog
                entityLabel="Dokument"
                itemTitle={doc.filename}
                action={() => deleteEmployeeDocument(doc.id)}
                successMessage="Dokument gelöscht."
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch keine Dokumente hinterlegt.
        </p>
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
        className="grid items-end gap-3 border-t pt-4 sm:grid-cols-2"
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
        <Button
          size="sm"
          variant="outline"
          type="submit"
          disabled={pending}
          className="sm:w-fit"
        >
          {pending ? "Wird gespeichert …" : "Hochladen"}
        </Button>
      </form>
    </div>
  );
}

/** Felder des Einladen-Dialogs. */
function InviteFields({
  defaultVacationDays,
  emailDomain,
}: {
  defaultVacationDays: number;
  emailDomain: string;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="firstName">Vorname</Label>
        <Input id="firstName" name="firstName" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lastName">Nachname</Label>
        <Input id="lastName" name="lastName" required />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="email">E-Mail-Adresse (@{emailDomain})</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder={`vorname.nachname@${emailDomain}`}
        />
      </div>
      <div className="space-y-1.5">
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
      <div className="space-y-1.5">
        <Label htmlFor="invite-entry-date">Eintrittsdatum (Pflichtfeld)</Label>
        <Input id="invite-entry-date" name="entryDate" type="date" required />
        <p className="text-xs text-muted-foreground">
          Der Intranet-Zugang ist erst ab diesem Tag freigeschaltet.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="entryYearVacationDays">
          Resturlaub im Eintrittsjahr (Pflichtfeld)
        </Label>
        <Input
          id="entryYearVacationDays"
          name="entryYearVacationDays"
          type="number"
          step="1"
          min="0"
          required
          defaultValue={0}
        />
        <p className="text-xs text-muted-foreground">
          Ganze Tage. Im Eintrittsjahr stehen nur diese Tage zur Verfügung; ab
          dem Folgejahr gilt der Jahresurlaubsanspruch.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-birth-date">Geburtsdatum (optional)</Label>
        <Input id="invite-birth-date" name="birthDate" type="date" />
        <p className="text-xs text-muted-foreground">
          Wird im Kalender als Geburtstag angezeigt — ohne Geburtsjahr.
        </p>
      </div>
      <div className="space-y-1.5">
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
      <div className="space-y-1.5">
        <Label htmlFor="invite-document-category">Dokument-Kategorie</Label>
        <CategorySelect
          id="invite-document-category"
          name="documentCategory"
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tabelle mit Aktionsspalte
// ---------------------------------------------------------------------------

function EmployeeRowActions({
  user,
  supervisorOptions,
}: {
  user: EmployeeRow;
  supervisorOptions: SupervisorOption[];
}) {
  return (
    <RowActions>
      <PanelDialog
        trigger={editTrigger}
        triggerLabel={<Pencil className="h-4 w-4" />}
        title={`${user.name} bearbeiten`}
        description="Jeder Abschnitt wird einzeln gespeichert."
        contentClassName="sm:max-w-2xl"
      >
        <div className="space-y-4">
          <DialogSection title="Urlaubskonto">
            <VacationEntitlementForm
              userId={user.id}
              annualVacationDays={user.annualVacationDays}
              vacationCarryoverDays={user.vacationCarryoverDays}
            />
          </DialogSection>
          <DialogSection title="Eintritt">
            <EntryForm
              userId={user.id}
              entryDate={user.entryDate}
              entryYearVacationDays={user.entryYearVacationDays}
            />
          </DialogSection>
          <DialogSection title="Geburtsdatum">
            <BirthdayForm userId={user.id} birthDate={user.birthDate} />
          </DialogSection>
          <DialogSection title="Vorgesetzte">
            <SupervisorsForm
              userId={user.id}
              technicalSupervisorId={user.technicalSupervisorId}
              disciplinarySupervisorId={user.disciplinarySupervisorId}
              isManagingDirector={user.isManagingDirector}
              options={supervisorOptions.filter((o) => o.id !== user.id)}
            />
          </DialogSection>
        </div>
      </PanelDialog>

      <PanelDialog
        trigger={iconTrigger("Dokumente")}
        triggerLabel={<FileText className="h-4 w-4" />}
        title={`Dokumente — ${user.name}`}
        description="Verschlüsselt abgelegt; Löschen entfernt Datei und Metadaten endgültig."
        contentClassName="sm:max-w-2xl"
      >
        <EmployeeDocumentsPanel
          userId={user.id}
          documents={user.documents}
        />
      </PanelDialog>

      {user.status === "eingeladen" && (
        <IconAction
          label="Einladung erneut senden"
          action={() => resendInvitation(user.id)}
          successMessage="Einladung erneut versendet."
        >
          <Mail className="h-4 w-4" />
        </IconAction>
      )}

      {!user.isSelf && user.status !== "deaktiviert" && (
        <ConfirmDialog
          trigger={iconTrigger("Deaktivieren")}
          triggerLabel={<UserX className="h-4 w-4" />}
          title="Zugang deaktivieren?"
          description={`Der Login von „${user.name}“ wird gesperrt. Anträge und Dokumente bleiben erhalten und der Zugang kann jederzeit reaktiviert werden.`}
          confirmLabel="Deaktivieren"
          pendingLabel="Wird deaktiviert …"
          action={() => setUserStatus(user.id, "deaktiviert")}
          successMessage="User deaktiviert — Login gesperrt, Antragsdaten bleiben erhalten."
          variant="destructive"
        />
      )}

      {!user.isSelf && user.status === "deaktiviert" && (
        <IconAction
          label="Reaktivieren"
          action={() => setUserStatus(user.id, "aktiv")}
          successMessage="User reaktiviert."
        >
          <UserCheck className="h-4 w-4" />
        </IconAction>
      )}
    </RowActions>
  );
}

function EmployeeTable({
  users,
  supervisorOptions,
  defaultVacationDays,
  emailDomain,
  hint,
  emptyLabel,
}: {
  users: EmployeeRow[];
  supervisorOptions: SupervisorOption[];
  defaultVacationDays: number;
  emailDomain: string;
  hint: string;
  emptyLabel: string;
}) {
  return (
    <TabSection
      hint={hint}
      isEmpty={users.length === 0}
      emptyLabel={emptyLabel}
      columns={
        <>
          <TableHead className="pl-4">Name</TableHead>
          <TableHead>E-Mail</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-28 text-right">Urlaub</TableHead>
          <TableHead className="w-36">Eintritt</TableHead>
          <TableHead className="w-32">Geburtstag</TableHead>
          <TableHead>Vorgesetzte</TableHead>
          <TableHead className="w-28 text-right">Dokumente</TableHead>
          <TableHead className="w-40 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      note="Deaktivierte Zugänge behalten ihre Anträge und Dokumente — Offboarding sperrt nur den Login."
      createAction={
        <FormDialog
          trigger={createTrigger}
          triggerLabel={
            <>
              <Plus className="h-4 w-4" />
              Mitarbeiter/in einladen
            </>
          }
          title="Neue/n Mitarbeiter/in einladen"
          description="Die Einladung wird sofort per E-Mail versendet; die Anmeldung ist erst ab dem Eintrittsdatum möglich."
          action={inviteUser}
          successMessage="Einladung versendet."
          submitLabel="Einladen"
        >
          <InviteFields
            defaultVacationDays={defaultVacationDays}
            emailDomain={emailDomain}
          />
        </FormDialog>
      }
    >
      {users.map((user) => (
        <TableRow key={user.id}>
          <TableCell className="pl-4 font-medium">
            <div className="flex flex-wrap items-center gap-2">
              {user.name}
              {user.isAdmin && <Badge>Admin</Badge>}
              {user.isManagingDirector && (
                <Badge variant="secondary">GF</Badge>
              )}
            </div>
          </TableCell>
          <TableCell>
            <span className="block max-w-[14rem] truncate text-muted-foreground 2xl:max-w-[20rem]">
              {user.email}
            </span>
          </TableCell>
          <TableCell>
            <StatusBadge status={user.status} />
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {user.annualVacationDays}
            {user.vacationCarryoverDays !== 0 &&
              ` + ${user.vacationCarryoverDays}`}{" "}
            T
          </TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {user.entryPending ? (
              <Badge
                variant="outline"
                className="bg-amber-100 text-amber-800 border-amber-200"
              >
                ab {user.entryLabel}
              </Badge>
            ) : (
              user.entryLabel
            )}
          </TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {user.birthdayLabel}
          </TableCell>
          <TableCell>
            <span className="block max-w-[16rem] truncate text-muted-foreground 2xl:max-w-[24rem]">
              {user.supervisorsLabel}
            </span>
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {user.documents.length}
          </TableCell>
          <TableCell className="pr-4">
            <EmployeeRowActions
              user={user}
              supervisorOptions={supervisorOptions}
            />
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

// ---------------------------------------------------------------------------
// Seiteneinstieg
// ---------------------------------------------------------------------------

export function UserAdminTabs({
  users,
  supervisorOptions,
  defaultVacationDays,
  emailDomain,
}: {
  users: EmployeeRow[];
  supervisorOptions: SupervisorOption[];
  defaultVacationDays: number;
  emailDomain: string;
}) {
  const active = users.filter((u) => u.status === "aktiv");
  const invited = users.filter((u) => u.status === "eingeladen");
  const deactivated = users.filter((u) => u.status === "deaktiviert");

  const tabs = [
    {
      value: "alle",
      label: "Alle",
      rows: users,
      hint: "Bearbeiten öffnet Urlaubskonto, Eintritt, Geburtsdatum und Vorgesetzte; Dokumente liegen in einem eigenen Dialog.",
      emptyLabel: "Noch keine Mitarbeitenden angelegt.",
    },
    {
      value: "aktiv",
      label: "Aktiv",
      rows: active,
      hint: "Angemeldete Mitarbeitende mit Zugang zum Intranet.",
      emptyLabel: "Keine aktiven Mitarbeitenden.",
    },
    {
      value: "eingeladen",
      label: "Eingeladen",
      rows: invited,
      hint: "Einladung versendet, aber noch keine Anmeldung erfolgt — vor dem Eintrittsdatum ist die Anmeldung gesperrt. Die Einladung lässt sich erneut senden.",
      emptyLabel: "Keine offenen Einladungen.",
    },
    {
      value: "deaktiviert",
      label: "Deaktiviert",
      rows: deactivated,
      hint: "Login gesperrt (Offboarding) — Anträge und Dokumente bleiben erhalten.",
      emptyLabel: "Keine deaktivierten Zugänge.",
    },
  ];

  return (
    <Tabs defaultValue="alle" className="gap-6">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            <span className="tabular-nums text-muted-foreground">
              {tab.rows.length}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <EmployeeTable
            users={tab.rows}
            supervisorOptions={supervisorOptions}
            defaultVacationDays={defaultVacationDays}
            emailDomain={emailDomain}
            hint={tab.hint}
            emptyLabel={tab.emptyLabel}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
