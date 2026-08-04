"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Download,
  FileText,
  PackageCheck,
  Pencil,
  Plus,
  Undo2,
  Upload,
} from "lucide-react";
import {
  DeleteDialog,
  FormDialog,
  RowActions,
  SectionTabsList,
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DEVICE_ID_PATTERN } from "@/lib/it-equipment";
import type { HandoverProtocolKind } from "@/db/schema";
import {
  analyzeEquipmentImport,
  applyEquipmentImport,
  createEquipment,
  createEquipmentType,
  deleteEquipment,
  deleteEquipmentType,
  deleteHandoverProtocol,
  markEquipmentReturned,
  toggleEquipmentType,
  undoEquipmentReturn,
  updateEquipment,
  updateEquipmentType,
  uploadHandoverProtocol,
  type ImportOutcome,
  type ImportSummary,
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

export interface HandoverProtocolItem {
  id: string;
  filename: string;
  createdAtLabel: string;
}

/** Eine Person mit ihren beiden Protokollen und der Zahl aktiver Geräte. */
export interface EmployeeProtocolRow {
  userId: string;
  userName: string;
  active: boolean;
  activeDevices: number;
  uebergabe: HandoverProtocolItem | null;
  ruecknahme: HandoverProtocolItem | null;
}

export interface EquipmentRow {
  id: string;
  userId: string;
  userName: string;
  typeId: string;
  typeName: string;
  deviceId: string;
  serialNumber: string | null;
  notes: string | null;
  handoverDate: string;
  handoverLabel: string;
  returnDate: string | null;
  returnLabel: string;
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
}: {
  idPrefix: string;
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
  item?: EquipmentRow;
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
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-device`}>Geräte-ID</Label>
        <Input
          id={`${idPrefix}-device`}
          name="deviceId"
          required
          pattern={DEVICE_ID_PATTERN}
          title="Nur Ziffern, Buchstaben und Bindestriche"
          defaultValue={item?.deviceId ?? ""}
          placeholder="z. B. IT-0042"
        />
      </div>
      <div className="space-y-1.5">
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
// Übergabe- und Rücknahmeprotokolle (je Person genau eines pro Art)
// ---------------------------------------------------------------------------

const PROTOCOL_LABELS = {
  uebergabe: "Übergabeprotokoll",
  ruecknahme: "Rücknahmeprotokoll",
} as const;

/** Zelle mit dem hinterlegten Protokoll samt Upload-, Ersetzen- und Löschweg. */
function ProtocolCell({
  row,
  kind,
}: {
  row: EmployeeProtocolRow;
  kind: HandoverProtocolKind;
}) {
  const document = kind === "uebergabe" ? row.uebergabe : row.ruecknahme;
  const label = PROTOCOL_LABELS[kind];
  const idPrefix = `protocol-${kind}-${row.userId}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {document ? (
        <>
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a
            href={`/api/it-dokumente/${document.id}`}
            target="_blank"
            rel="noreferrer"
            className="block max-w-[12rem] truncate text-sm underline underline-offset-2 hover:text-primary 2xl:max-w-[18rem]"
          >
            {document.filename}
          </a>
          <span className="text-xs text-muted-foreground">
            {document.createdAtLabel}
          </span>
          <FormDialog
            trigger={iconTrigger(`${label} ersetzen`)}
            triggerLabel={<Upload className="h-4 w-4" />}
            title={`${label} ersetzen`}
            description={`Für ${row.userName} ist „${document.filename}“ hinterlegt. Beim Speichern wird diese Datei endgültig gelöscht und durch die neue ersetzt.`}
            action={uploadHandoverProtocol.bind(null, row.userId, kind)}
            successMessage={`${label} ersetzt.`}
            submitLabel="Ersetzen"
          >
            <ProtocolFileField idPrefix={idPrefix} />
          </FormDialog>
          <DeleteDialog
            entityLabel={label}
            itemTitle={document.filename}
            action={() => deleteHandoverProtocol(document.id)}
            successMessage={`${label} gelöscht.`}
          />
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">—</span>
          <FormDialog
            trigger={iconTrigger(`${label} hochladen`)}
            triggerLabel={<Upload className="h-4 w-4" />}
            title={`${label} hochladen`}
            description={`Verschlüsselt abgelegt und ausschließlich für den Admin abrufbar — für ${row.userName}.`}
            action={uploadHandoverProtocol.bind(null, row.userId, kind)}
            successMessage={`${label} gespeichert.`}
            submitLabel="Hochladen"
          >
            <ProtocolFileField idPrefix={idPrefix} />
          </FormDialog>
        </>
      )}
    </div>
  );
}

function ProtocolFileField({ idPrefix }: { idPrefix: string }) {
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <Label htmlFor={`${idPrefix}-file`}>Datei</Label>
      <Input
        id={`${idPrefix}-file`}
        name="document"
        type="file"
        required
        accept={FILE_ACCEPT}
      />
      <p className="text-xs text-muted-foreground">{FILE_HINT}</p>
    </div>
  );
}

function HandoverProtocolsTable({ rows }: { rows: EmployeeProtocolRow[] }) {
  return (
    <TabSection
      hint="Die Ausstattung wird gesammelt übergeben — deshalb gibt es je Person genau ein Übergabe- und ein Rücknahmeprotokoll."
      isEmpty={rows.length === 0}
      emptyLabel="Noch keine Mitarbeitenden angelegt."
      columns={
        <>
          <TableHead className="pl-4">Mitarbeiter/in</TableHead>
          <TableHead className="w-32 text-right">Im Einsatz</TableHead>
          <TableHead>Übergabeprotokoll</TableHead>
          <TableHead className="pr-4">Rücknahmeprotokoll</TableHead>
        </>
      }
      note="Ein neuer Upload ersetzt das bisherige Protokoll und löscht dessen Datei endgültig. Jeder Abruf wird im Audit-Log vermerkt."
      createAction={null}
    >
      {rows.map((row) => (
        <TableRow key={row.userId}>
          <TableCell className="pl-4 font-medium">
            <span className="flex flex-wrap items-center gap-2">
              {row.userName}
              {!row.active && (
                <Badge
                  variant="outline"
                  className="border-gray-200 bg-gray-100 text-gray-600"
                >
                  deaktiviert
                </Badge>
              )}
            </span>
          </TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">
            {row.activeDevices}
          </TableCell>
          <TableCell>
            <ProtocolCell row={row} kind="uebergabe" />
          </TableCell>
          <TableCell className="pr-4">
            <ProtocolCell row={row} kind="ruecknahme" />
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
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
          <TableHead className="w-32 pl-4">Geräte-ID</TableHead>
          <TableHead>Mitarbeiter/in</TableHead>
          <TableHead>Ausstattung</TableHead>
          <TableHead>Seriennummer</TableHead>
          <TableHead className="w-32">Übernahme</TableHead>
          <TableHead className="w-32">Rückgabe</TableHead>
          <TableHead>Zusatzinfo</TableHead>
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
          <TableCell className="pl-4 font-medium tabular-nums">
            {item.deviceId}
          </TableCell>
          <TableCell className="font-medium">{item.userName}</TableCell>
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
// CSV-Export und -Import
// ---------------------------------------------------------------------------

const SUMMARY_PREVIEW_LIMIT = 20;

function SummaryLine({ label, items }: { label: string; items: string[] }) {
  const shown = items.slice(0, SUMMARY_PREVIEW_LIMIT);
  const rest = items.length - shown.length;

  return (
    <div className="space-y-0.5">
      <p className="text-sm">
        {label}: <span className="font-medium tabular-nums">{items.length}</span>
      </p>
      {shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {shown.join(", ")}
          {rest > 0 && ` … und ${rest} weitere`}
        </p>
      )}
    </div>
  );
}

function EquipmentImportExport() {
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const run = (
    action: (formData: FormData) => Promise<ImportOutcome>,
    onSuccess: (summary: ImportSummary) => void
  ) => {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const outcome = await action(formData);
      if (!outcome.ok) {
        setSummary(null);
        setErrors(outcome.errors);
        return;
      }
      setErrors([]);
      onSuccess(outcome.summary);
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Exportieren</h3>
        <p className="text-sm text-muted-foreground">
          Lädt alle Geräte — im Einsatz und zurückgegeben — als CSV-Datei mit
          Semikolon als Trennzeichen. Excel öffnet sie per Doppelklick, und sie
          dient gleichzeitig als Vorlage für den Import.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            window.location.href = "/api/exports/it-ausstattung";
          }}
        >
          <Download className="h-4 w-4" />
          Liste als CSV herunterladen
        </Button>
      </section>

      <section className="space-y-3 border-t pt-6">
        <h3 className="text-sm font-medium">Importieren</h3>
        <p className="text-sm text-muted-foreground">
          Der Import gleicht über die Spalte „Geräte-ID“ ab: bekannte IDs werden
          aktualisiert, neue Zeilen angelegt, und Geräte, die in der Datei
          fehlen, werden gelöscht. Zum Umbenennen eines Geräts die Spalte
          „Geräte-ID neu (optional)“ füllen. Die Übergabeprotokolle bleiben
          unberührt, da sie an der Person hängen.
        </p>

        <div className="grid items-end gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="equipment-import-file">CSV-Datei (max. 1 MB)</Label>
            <Input
              key={fileKey}
              id="equipment-import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setSummary(null);
                setErrors([]);
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={!file || pending}
            onClick={() => run(analyzeEquipmentImport, setSummary)}
          >
            {pending ? "Wird geprüft …" : "Datei prüfen"}
          </Button>
        </div>

        {errors.length > 0 && (
          <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium">
              Die Datei wurde nicht übernommen
              {errors.length > 1 && ` (${errors.length} Hinweise)`}:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {errors.slice(0, SUMMARY_PREVIEW_LIMIT).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            {errors.length > SUMMARY_PREVIEW_LIMIT && (
              <p className="text-xs text-muted-foreground">
                … und {errors.length - SUMMARY_PREVIEW_LIMIT} weitere Meldungen.
              </p>
            )}
          </div>
        )}

        {summary && (
          <div className="space-y-4 rounded-lg ring-1 ring-foreground/10 p-4">
            <div className="space-y-2">
              <SummaryLine label="Neu angelegt" items={summary.create} />
              <SummaryLine label="Aktualisiert" items={summary.update} />
              <SummaryLine label="Gelöscht" items={summary.remove} />
              <p className="text-sm">
                Unverändert:{" "}
                <span className="font-medium tabular-nums">
                  {summary.unchanged.length}
                </span>
              </p>
            </div>

            {summary.remove.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                {summary.remove.length === 1
                  ? "Ein Gerät fehlt in der Datei und wird endgültig gelöscht."
                  : `${summary.remove.length} Geräte fehlen in der Datei und werden endgültig gelöscht.`}{" "}
                Fehlt eine Zeile nur versehentlich, bitte die Datei ergänzen und
                erneut prüfen.
              </p>
            )}

            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(applyEquipmentImport, (applied) => {
                  toast.success(
                    `Import übernommen: ${applied.create.length} neu, ${applied.update.length} aktualisiert, ${applied.remove.length} gelöscht.`
                  );
                  setSummary(null);
                  setFile(null);
                  setFileKey((key) => key + 1);
                })
              }
            >
              {pending ? "Wird übernommen …" : "Import jetzt anwenden"}
            </Button>
          </div>
        )}
      </section>
    </div>
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
  protocolRows,
}: {
  active: EquipmentRow[];
  returned: EquipmentRow[];
  employees: EmployeeOption[];
  types: EquipmentTypeOption[];
  typeRows: EquipmentTypeRow[];
  protocolRows: EmployeeProtocolRow[];
}) {
  return (
    <Tabs defaultValue="aktiv" className="gap-6">
      <SectionTabsList
        tabs={[
          { value: "aktiv", label: "Im Einsatz", count: active.length },
          { value: "zurueck", label: "Zurückgegeben", count: returned.length },
          {
            value: "personen",
            label: "Mitarbeitende",
            count: protocolRows.length,
          },
          {
            value: "arten",
            label: "Ausstattungsarten",
            count: typeRows.length,
          },
          { value: "austausch", label: "Export & Import" },
        ]}
      />

      <TabsContent value="aktiv">
        <EquipmentTable
          items={active}
          employees={employees}
          types={types}
          hint="Aktuell ausgegebene Ausstattung — sortiert nach Geräte-ID."
          emptyLabel="Aktuell ist keine Ausstattung ausgegeben."
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
      <TabsContent value="personen">
        <HandoverProtocolsTable rows={protocolRows} />
      </TabsContent>
      <TabsContent value="arten">
        <EquipmentTypesTable types={typeRows} />
      </TabsContent>
      <TabsContent value="austausch">
        <EquipmentImportExport />
      </TabsContent>
    </Tabs>
  );
}
