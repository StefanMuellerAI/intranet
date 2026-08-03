"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { FileText, PackageCheck, Pencil, Plus, Undo2 } from "lucide-react";
import {
  DeleteDialog,
  FormDialog,
  PanelDialog,
  RowActions,
  TabSection,
  VisibilityBadge,
  VisibilityToggle,
  createTrigger,
  editTrigger,
  iconTrigger,
  useAction,
} from "@/components/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createEquipment,
  createEquipmentType,
  deleteEquipment,
  deleteEquipmentDocument,
  deleteEquipmentType,
  markEquipmentReturned,
  toggleEquipmentType,
  undoEquipmentReturn,
  updateEquipment,
  updateEquipmentType,
  uploadEquipmentDocuments,
} from "@/app/(app)/it-management/actions";

export interface EmployeeOption {
  id: string;
  name: string;
  /** Deaktivierte Zugänge stehen für neue Zuordnungen nicht zur Auswahl */
  selectable: boolean;
}

export interface EquipmentTypeOption {
  id: string;
  name: string;
  /** Ausgeblendete Arten stehen für neue Zuordnungen nicht zur Auswahl */
  selectable: boolean;
}

export interface EquipmentDocumentItem {
  id: string;
  filename: string;
  createdAtLabel: string;
}

export interface EquipmentRow {
  id: string;
  userId: string;
  userName: string;
  typeId: string;
  typeName: string;
  serialNumber: string | null;
  notes: string | null;
  handoverDate: string;
  handoverLabel: string;
  returnDate: string | null;
  returnLabel: string;
  documents: EquipmentDocumentItem[];
}

export interface EquipmentTypeRow {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
  /** Anzahl der Einträge, die diese Art verwenden — blockiert das Löschen */
  usageCount: number;
}

const FILE_ACCEPT = "application/pdf,image/jpeg,image/png";
const FILE_HINT = "PDF/JPG/PNG, max. 10 MB pro Datei — verschlüsselt gespeichert.";

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/**
 * Auswahlfeld im Stil der übrigen Formularfelder. Nicht mehr auswählbare
 * Einträge (deaktivierte Mitarbeitende, ausgeblendete Arten) bleiben
 * sichtbar, solange sie bereits zugeordnet sind.
 */
function OptionSelect({
  id,
  name,
  defaultValue,
  placeholder,
  options,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder: string;
  options: { id: string; name: string; selectable: boolean }[];
}) {
  const visible = options.filter((o) => o.selectable || o.id === defaultValue);

  return (
    <select
      id={id}
      name={name}
      required
      defaultValue={defaultValue ?? ""}
      className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {visible.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function EquipmentStatusBadge({ returnDate }: { returnDate: string | null }) {
  return returnDate === null ? (
    <Badge
      variant="outline"
      className="border-green-200 bg-green-100 text-green-800"
    >
      im Einsatz
    </Badge>
  ) : (
    <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-600">
      zurückgegeben
    </Badge>
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
// Formularfelder — von Anlegen- und Bearbeiten-Dialog gemeinsam genutzt
// ---------------------------------------------------------------------------

function EquipmentFields({
  idPrefix,
  employees,
  types,
  item,
  withUpload,
}: {
  idPrefix: string;
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
  item?: EquipmentRow;
  withUpload?: boolean;
}) {
  return (
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-user`}>Mitarbeiter/in</Label>
        <OptionSelect
          id={`${idPrefix}-user`}
          name="userId"
          defaultValue={item?.userId}
          placeholder="— bitte wählen —"
          options={employees}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-type`}>Ausstattung</Label>
        <OptionSelect
          id={`${idPrefix}-type`}
          name="typeId"
          defaultValue={item?.typeId}
          placeholder="— bitte wählen —"
          options={types}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-serial`}>Seriennummer (optional)</Label>
        <Input
          id={`${idPrefix}-serial`}
          name="serialNumber"
          defaultValue={item?.serialNumber ?? ""}
          placeholder="z. B. C02XL0THJGH5"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-handover`}>Übernahme am</Label>
        <Input
          id={`${idPrefix}-handover`}
          name="handoverDate"
          type="date"
          required
          defaultValue={item?.handoverDate}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-return`}>Rückgabe am (optional)</Label>
        <Input
          id={`${idPrefix}-return`}
          name="returnDate"
          type="date"
          defaultValue={item?.returnDate ?? ""}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-notes`}>
          Zusatzinformationen (optional)
        </Label>
        <Textarea
          id={`${idPrefix}-notes`}
          name="notes"
          rows={3}
          defaultValue={item?.notes ?? ""}
          placeholder="z. B. Modell, Zubehör, Zustand bei Übergabe"
        />
      </div>
      {withUpload && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-documents`}>
            Übergabeprotokoll(e) (optional)
          </Label>
          <Input
            id={`${idPrefix}-documents`}
            name="documents"
            type="file"
            multiple
            accept={FILE_ACCEPT}
          />
          <p className="text-xs text-muted-foreground">{FILE_HINT}</p>
        </div>
      )}
    </>
  );
}

function EquipmentTypeFields({
  idPrefix,
  type,
}: {
  idPrefix: string;
  type?: EquipmentTypeRow;
}) {
  return (
    <>
      {type && <input type="hidden" name="id" value={type.id} />}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Bezeichnung</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          required
          defaultValue={type?.name}
          placeholder="z. B. Dockingstation"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-sort`}>Reihenfolge</Label>
        <Input
          id={`${idPrefix}-sort`}
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={type?.sortOrder ?? 0}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Übergabeprotokolle
// ---------------------------------------------------------------------------

function ProtocolsPanel({
  equipmentId,
  documents,
}: {
  equipmentId: string;
  documents: EquipmentDocumentItem[];
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadWithId = uploadEquipmentDocuments.bind(null, equipmentId);

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
                href={`/api/it-dokumente/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-primary"
              >
                {doc.filename}
              </a>
              <span className="text-xs text-muted-foreground">
                {doc.createdAtLabel}
              </span>
              <DeleteDialog
                entityLabel="Protokoll"
                itemTitle={doc.filename}
                action={() => deleteEquipmentDocument(doc.id)}
                successMessage="Protokoll gelöscht."
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Noch kein Übergabeprotokoll hinterlegt.
        </p>
      )}

      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            try {
              await uploadWithId(fd);
              formRef.current?.reset();
              toast.success("Protokoll(e) verschlüsselt gespeichert.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Fehler");
            }
          })
        }
        className="grid items-end gap-3 border-t pt-4 sm:grid-cols-2"
      >
        <div className="space-y-1">
          <Label htmlFor={`protocol-files-${equipmentId}`} className="text-xs">
            Datei(en) — PDF/JPG/PNG, max. 10 MB
          </Label>
          <Input
            id={`protocol-files-${equipmentId}`}
            name="documents"
            type="file"
            multiple
            required
            accept={FILE_ACCEPT}
          />
        </div>
        <Button size="sm" variant="outline" type="submit" disabled={pending}>
          {pending ? "Wird hochgeladen …" : "Hochladen"}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabelle mit Aktionsspalte
// ---------------------------------------------------------------------------

function EquipmentRowActions({
  item,
  employees,
  types,
}: {
  item: EquipmentRow;
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
}) {
  return (
    <RowActions>
      <FormDialog
        trigger={editTrigger}
        triggerLabel={<Pencil className="h-4 w-4" />}
        title={`${item.typeName} — ${item.userName}`}
        description="Zuordnung, Seriennummer, Daten und Zusatzinformationen ändern."
        action={updateEquipment}
        successMessage="Ausstattung aktualisiert."
        submitLabel="Speichern"
      >
        <EquipmentFields
          idPrefix={`eq-${item.id}`}
          employees={employees}
          types={types}
          item={item}
        />
      </FormDialog>

      <PanelDialog
        trigger={iconTrigger("Übergabeprotokolle")}
        triggerLabel={<FileText className="h-4 w-4" />}
        title={`Übergabeprotokolle — ${item.typeName}`}
        description="Verschlüsselt abgelegt; Löschen entfernt Datei und Metadaten endgültig."
        contentClassName="sm:max-w-2xl"
      >
        <ProtocolsPanel equipmentId={item.id} documents={item.documents} />
      </PanelDialog>

      {item.returnDate === null ? (
        <FormDialog
          trigger={iconTrigger("Rückgabe erfassen")}
          triggerLabel={<PackageCheck className="h-4 w-4" />}
          title="Rückgabe erfassen"
          description={`„${item.typeName}“ von ${item.userName} — übernommen am ${item.handoverLabel}.`}
          action={markEquipmentReturned.bind(null, item.id)}
          successMessage="Rückgabe erfasst."
          submitLabel="Rückgabe speichern"
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`return-${item.id}`}>Rückgabe am</Label>
            <Input
              id={`return-${item.id}`}
              name="returnDate"
              type="date"
              required
              min={item.handoverDate}
            />
          </div>
        </FormDialog>
      ) : (
        <IconAction
          label="Rückgabe zurücknehmen"
          action={() => undoEquipmentReturn(item.id)}
          successMessage="Ausstattung gilt wieder als im Einsatz."
        >
          <Undo2 className="h-4 w-4" />
        </IconAction>
      )}

      <DeleteDialog
        entityLabel="Ausstattung"
        itemTitle={`${item.typeName} — ${item.userName}`}
        action={() => deleteEquipment(item.id)}
        successMessage="Ausstattung gelöscht."
      />
    </RowActions>
  );
}

function EquipmentTable({
  items,
  employees,
  types,
  hint,
  emptyLabel,
  note,
  showCreate,
}: {
  items: EquipmentRow[];
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
  hint: string;
  emptyLabel: string;
  note?: string;
  showCreate: boolean;
}) {
  const hasSelectableTypes = types.some((t) => t.selectable);

  return (
    <TabSection
      hint={hint}
      isEmpty={items.length === 0}
      emptyLabel={emptyLabel}
      columns={
        <>
          <TableHead className="pl-4">Mitarbeiter/in</TableHead>
          <TableHead>Ausstattung</TableHead>
          <TableHead>Seriennummer</TableHead>
          <TableHead className="w-32">Übernahme</TableHead>
          <TableHead className="w-32">Rückgabe</TableHead>
          <TableHead>Zusatzinfo</TableHead>
          <TableHead className="w-28 text-right">Protokolle</TableHead>
          <TableHead className="w-36">Status</TableHead>
          <TableHead className="w-40 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      note={note}
      createAction={
        showCreate ? (
          hasSelectableTypes ? (
            <FormDialog
              trigger={createTrigger}
              triggerLabel={
                <>
                  <Plus className="h-4 w-4" />
                  Ausstattung erfassen
                </>
              }
              title="Ausstattung erfassen"
              description="Ohne Rückgabedatum gilt die Ausstattung als im Einsatz."
              action={createEquipment}
              successMessage="Ausstattung erfasst."
              submitLabel="Ausstattung speichern"
            >
              <EquipmentFields
                idPrefix="eq-new"
                employees={employees}
                types={types}
                withUpload
              />
            </FormDialog>
          ) : (
            <p className="text-sm text-muted-foreground">
              Bitte zuerst im Reiter „Ausstattungsarten“ eine Art anlegen.
            </p>
          )
        ) : null
      }
    >
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="pl-4 font-medium">{item.userName}</TableCell>
          <TableCell>{item.typeName}</TableCell>
          <TableCell className="text-muted-foreground">
            <span className="block max-w-[10rem] truncate 2xl:max-w-[16rem]">
              {item.serialNumber ?? "—"}
            </span>
          </TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {item.handoverLabel}
          </TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {item.returnLabel}
          </TableCell>
          <TableCell>
            <span className="block max-w-[14rem] truncate text-muted-foreground 2xl:max-w-[24rem]">
              {item.notes || "—"}
            </span>
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {item.documents.length}
          </TableCell>
          <TableCell>
            <EquipmentStatusBadge returnDate={item.returnDate} />
          </TableCell>
          <TableCell className="pr-4">
            <EquipmentRowActions
              item={item}
              employees={employees}
              types={types}
            />
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

// ---------------------------------------------------------------------------
// Ausstattungsarten
// ---------------------------------------------------------------------------

function EquipmentTypesTable({ types }: { types: EquipmentTypeRow[] }) {
  return (
    <TabSection
      hint="Bestimmen die Auswahl beim Erfassen von Ausstattung — sortiert nach Reihenfolge."
      isEmpty={types.length === 0}
      emptyLabel="Noch keine Ausstattungsarten angelegt."
      columns={
        <>
          <TableHead className="w-16 pl-4 text-right">Nr.</TableHead>
          <TableHead>Bezeichnung</TableHead>
          <TableHead className="w-32 text-right">Zugeordnet</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-32 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      note="Verwendete Arten lassen sich nicht löschen, nur ausblenden — so bleibt die Historie lesbar."
      createAction={
        <FormDialog
          trigger={createTrigger}
          triggerLabel={
            <>
              <Plus className="h-4 w-4" />
              Neue Ausstattungsart
            </>
          }
          title="Ausstattungsart anlegen"
          description="Steht danach beim Erfassen von Ausstattung zur Auswahl."
          action={createEquipmentType}
          successMessage="Ausstattungsart angelegt."
          submitLabel="Art hinzufügen"
        >
          <EquipmentTypeFields idPrefix="type" />
        </FormDialog>
      }
    >
      {types.map((type) => (
        <TableRow key={type.id}>
          <TableCell className="pl-4 text-right tabular-nums text-muted-foreground">
            {type.sortOrder}
          </TableCell>
          <TableCell className="font-medium">{type.name}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {type.usageCount}
          </TableCell>
          <TableCell>
            <VisibilityBadge active={type.active} />
          </TableCell>
          <TableCell className="pr-4">
            <RowActions>
              <VisibilityToggle
                active={type.active}
                action={() => toggleEquipmentType(type.id)}
                hiddenMessage="Ausstattungsart ausgeblendet."
                shownMessage="Ausstattungsart eingeblendet."
              />
              <FormDialog
                trigger={editTrigger}
                triggerLabel={<Pencil className="h-4 w-4" />}
                title="Ausstattungsart bearbeiten"
                action={updateEquipmentType}
                successMessage="Ausstattungsart aktualisiert."
                submitLabel="Speichern"
              >
                <EquipmentTypeFields
                  idPrefix={`type-${type.id}`}
                  type={type}
                />
              </FormDialog>
              {type.usageCount === 0 && (
                <DeleteDialog
                  entityLabel="Ausstattungsart"
                  itemTitle={type.name}
                  action={() => deleteEquipmentType(type.id)}
                  successMessage="Ausstattungsart gelöscht."
                />
              )}
            </RowActions>
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

// ---------------------------------------------------------------------------
// Seiteneinstieg
// ---------------------------------------------------------------------------

export function ITEquipmentTabs({
  active,
  returned,
  employees,
  types,
  typeRows,
}: {
  active: EquipmentRow[];
  returned: EquipmentRow[];
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
  typeRows: EquipmentTypeRow[];
}) {
  return (
    <Tabs defaultValue="aktiv" className="gap-6">
      <TabsList>
        <TabsTrigger value="aktiv">
          Im Einsatz
          <span className="tabular-nums text-muted-foreground">
            {active.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="zurueck">
          Zurückgegeben
          <span className="tabular-nums text-muted-foreground">
            {returned.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="arten">
          Ausstattungsarten
          <span className="tabular-nums text-muted-foreground">
            {typeRows.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="aktiv">
        <EquipmentTable
          items={active}
          employees={employees}
          types={types}
          hint="Aktuell ausgegebene Ausstattung — sortiert nach Mitarbeiter/in."
          emptyLabel="Aktuell ist keine Ausstattung ausgegeben."
          note="Übergabeprotokolle liegen verschlüsselt im Blob-Store und sind ausschließlich hier abrufbar."
          showCreate
        />
      </TabsContent>
      <TabsContent value="zurueck">
        <EquipmentTable
          items={returned}
          employees={employees}
          types={types}
          hint="Bereits zurückgegebene Ausstattung — bleibt als Nachweis erhalten."
          emptyLabel="Noch keine Rückgaben erfasst."
          showCreate={false}
        />
      </TabsContent>
      <TabsContent value="arten">
        <EquipmentTypesTable types={typeRows} />
      </TabsContent>
    </Tabs>
  );
}
