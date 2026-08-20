import { desc, eq } from "drizzle-orm";
import {
  apiKeys,
  db,
  deputyAssignments,
  users,
  webhookConfigs,
  webhookDeliveries,
} from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { DECIMAL_PATTERN, DECIMAL_TITLE } from "@/lib/form-patterns";
import { getRetentionReport } from "@/lib/retention";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import {
  ActionForm,
  ApiKeyPanel,
  DeputyPanel,
  WebhookRowActions,
} from "@/components/settings-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  addWebhook,
  updateCommissionRates,
  updateQuotas,
  updateRates,
  updateRetention,
} from "./actions";

export const metadata = { title: "Einstellungen" };

const euro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

function RateField({
  name,
  label,
  cents,
}: {
  name: string;
  label: string;
  cents: number;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={euro(cents)}
        inputMode="decimal"
        pattern={DECIMAL_PATTERN}
        title={DECIMAL_TITLE}
      />
    </div>
  );
}

export default async function EinstellungenPage() {
  const admin = await requireAdmin();
  const settings = await getSettings();
  const retention = await getRetentionReport(settings);

  const [activeUsers, deputies, webhooks, deliveries, keys] =
    await Promise.all([
      db.select().from(users).where(eq(users.status, "aktiv")),
      db
        .select()
        .from(deputyAssignments)
        .where(eq(deputyAssignments.active, true)),
      db.select().from(webhookConfigs).orderBy(desc(webhookConfigs.createdAt)),
      db
        .select()
        .from(webhookDeliveries)
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(20),
      db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    ]);

  const currentDeputy = deputies[0]
    ? {
        userId: deputies[0].userId,
        name: fullName(
          activeUsers.find((u) => u.id === deputies[0].userId) ?? {
            firstName: "Unbekannt",
            lastName: "",
          }
        ),
        startsOn: deputies[0].startsOn,
        endsOn: deputies[0].endsOn,
      }
    : null;

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Einstellungen"
        description="Sätze, Kontingente, Vertretung, Webhooks, API-Keys und Compliance"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Jahresurlaub und Workation-Kontingente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={updateQuotas}
            successMessage="Kontingente gespeichert."
            className="grid gap-4 sm:grid-cols-3 items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="defaultAnnualVacationDays">
                Jahresurlaub-Standardwert (Tage)
              </Label>
              <Input
                id="defaultAnnualVacationDays"
                name="defaultAnnualVacationDays"
                type="number"
                step="0.5"
                defaultValue={settings.defaultAnnualVacationDays}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="workationYearlyLimitDays">
                Workation: max. Arbeitstage/Jahr
              </Label>
              <Input
                id="workationYearlyLimitDays"
                name="workationYearlyLimitDays"
                type="number"
                defaultValue={settings.workationYearlyLimitDays}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="workationConsecutiveLimitDays">
                Workation: max. Tage am Stück
              </Label>
              <Input
                id="workationConsecutiveLimitDays"
                name="workationConsecutiveLimitDays"
                type="number"
                defaultValue={settings.workationConsecutiveLimitDays}
              />
            </div>
            <Button type="submit" className="sm:col-span-3 w-fit">
              Speichern
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Reisekosten-Sätze (Startwerte aus dem Blatt „Sätze“)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Alle Beträge in Euro. Auslandsreisen: länderspezifische BMF-Sätze
            sind nicht hinterlegt.
          </p>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={updateRates}
            successMessage="Sätze gespeichert."
            className="grid gap-4 sm:grid-cols-4"
          >
            <RateField
              name="rateFullDay"
              label="Voller Reisetag"
              cents={settings.rateFullDayCents}
            />
            <RateField
              name="ratePartialDay"
              label="An-/Abreisetag bzw. über 8 Std."
              cents={settings.ratePartialDayCents}
            />
            <RateField
              name="rateReductionBreakfast"
              label="Kürzung Frühstück"
              cents={settings.rateReductionBreakfastCents}
            />
            <RateField
              name="rateReductionLunch"
              label="Kürzung Mittagessen"
              cents={settings.rateReductionLunchCents}
            />
            <RateField
              name="rateReductionDinner"
              label="Kürzung Abendessen"
              cents={settings.rateReductionDinnerCents}
            />
            <RateField
              name="rateKm"
              label="km-Pauschale Privat-Pkw"
              cents={settings.rateKmCents}
            />
            <RateField
              name="ratePassengerKm"
              label="Zuschlag je Person und km"
              cents={settings.ratePassengerKmCents}
            />
            <RateField
              name="employerDailySupplement"
              label="Freiwilliger Tageszuschlag (pauschal versteuert)"
              cents={settings.employerDailySupplementCents}
            />
            <Button type="submit" className="sm:col-span-4 w-fit">
              Speichern
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Provisionssätze (Folgegeschäfte)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Vertragswerte als Standard: Folge-Trainings je zusätzlich
            bestelltem Training, Folgeberatungen als Prozentsatz vom
            Nettoauftragswert. Neukunden-Vermittlungsprovision wird im
            Einzelfall bei der Freigabe eingetragen.
          </p>
        </CardHeader>
        <CardContent>
          <ActionForm
            action={updateCommissionRates}
            successMessage="Provisionssätze gespeichert."
            className="grid gap-4 sm:grid-cols-4"
          >
            <RateField
              name="commissionHalfDay"
              label="Training halbtägig (€)"
              cents={settings.commissionHalfDayCents}
            />
            <RateField
              name="commissionFullDay"
              label="Training ganztägig (€)"
              cents={settings.commissionFullDayCents}
            />
            <RateField
              name="commissionTwoDay"
              label="Training zweitägig (€)"
              cents={settings.commissionTwoDayCents}
            />
            <div className="space-y-1">
              <Label htmlFor="commissionConsultingPercent">
                Folgeberatung (% vom Nettoauftragswert)
              </Label>
              <Input
                id="commissionConsultingPercent"
                name="commissionConsultingPercent"
                inputMode="decimal"
                pattern={DECIMAL_PATTERN}
                title={DECIMAL_TITLE}
                defaultValue={String(
                  settings.commissionConsultingPercent
                ).replace(".", ",")}
              />
            </div>
            <Button type="submit" className="sm:col-span-4 w-fit">
              Speichern
            </Button>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vertretung</CardTitle>
          <p className="text-xs text-muted-foreground">
            Die Vertretung darf Anträge genehmigen/beanstandet, aber keine
            eigenen Anträge genehmigen und keine Verwaltungsfunktionen nutzen.
          </p>
        </CardHeader>
        <CardContent>
          <DeputyPanel
            users={activeUsers
              .filter((u) => u.id !== admin.id)
              .map((u) => ({ id: u.id, name: fullName(u) }))}
            current={currentDeputy}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">n8n-Webhooks</CardTitle>
          <p className="text-xs text-muted-foreground">
            Absicherung per HMAC-SHA256-Signatur (Header X-StefanAI-Signature),
            3 Zustellversuche mit Backoff.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm
            action={addWebhook}
            successMessage="Webhook angelegt."
            className="grid gap-3 sm:grid-cols-5 items-end"
          >
            <div className="space-y-1">
              <Label>Kategorie</Label>
              <select
                name="category"
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="urlaub">Urlaub</option>
                <option value="workation">Workation</option>
                <option value="reisekosten">Reisekosten</option>
                <option value="krankmeldung">Krankmeldung</option>
                <option value="provision">Provision</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Ereignis</Label>
              <select
                name="event"
                className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="genehmigt">genehmigt</option>
                <option value="eingereicht">eingereicht</option>
                <option value="beanstandet">beanstandet</option>
                <option value="storniert">storniert</option>
                <option value="gemeldet">gemeldet (Krankmeldung)</option>
                <option value="abgeschlossen">abgeschlossen</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Webhook-URL (https)</Label>
              <Input name="url" placeholder="https://n8n.example/webhook/…" />
            </div>
            <div className="space-y-1">
              <Label>Secret (min. 16 Zeichen)</Label>
              <Input name="secret" type="password" />
            </div>
            <Button type="submit">Hinzufügen</Button>
          </ActionForm>

          {webhooks.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Ereignis</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.category}</TableCell>
                    <TableCell>{w.event}</TableCell>
                    <TableCell className="max-w-56 truncate">{w.url}</TableCell>
                    <TableCell>
                      <Badge variant={w.active ? "default" : "outline"}>
                        {w.active ? "aktiv" : "inaktiv"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <WebhookRowActions id={w.id} active={w.active} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium">
              Zustell-Log (letzte 20)
            </h3>
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Zustellungen.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Zeitpunkt</TableHead>
                    <TableHead>Ereignis</TableHead>
                    <TableHead>Versuche</TableHead>
                    <TableHead>HTTP</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        {d.createdAt.toLocaleString("de-DE")}
                      </TableCell>
                      <TableCell>{d.event}</TableCell>
                      <TableCell>{d.attempts}</TableCell>
                      <TableCell>{d.responseStatus ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            d.status === "erfolgreich"
                              ? "bg-green-100 text-green-800"
                              : d.status === "fehlgeschlagen"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                          }
                        >
                          {d.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            API-Keys (Freigabe-API für KI-gestützte Freigaben)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Der Umfang wird beim Anlegen festgelegt und ist später nicht mehr
            änderbar; Keys sind jederzeit widerrufbar. Ein Key vom Typ „Website
            (nur Zitate)“ erreicht ausschließlich die Zitate-Schnittstelle und
            eignet sich damit zur Weitergabe an externe Dienstleister. Alle
            API-Aktionen erscheinen im Audit-Log mit Kennzeichnung „API“.
          </p>
        </CardHeader>
        <CardContent>
          <ApiKeyPanel
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              keyPrefix: k.keyPrefix,
              scope: k.scope,
              createdAt: k.createdAt.toLocaleDateString("de-DE"),
              revokedAt: k.revokedAt
                ? k.revokedAt.toLocaleDateString("de-DE")
                : null,
              lastUsedAt: k.lastUsedAt
                ? k.lastUsedAt.toLocaleString("de-DE")
                : null,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Reisekosten-Export für die Lohnabrechnung
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Genehmigte Abrechnungen eines Monats mit getrenntem Ausweis von
            steuerfreien Pauschalen, pauschal versteuertem Zuschlag und
            Beleg-Erstattungen.
          </p>
        </CardHeader>
        <CardContent>
          <form
            action="/api/exports/expenses"
            method="get"
            className="flex flex-wrap items-end gap-2"
          >
            <div className="space-y-1">
              <Label htmlFor="export-month">Monat</Label>
              <Input
                id="export-month"
                name="monat"
                type="month"
                defaultValue={defaultMonth}
                className="w-44"
              />
            </div>
            <Button type="submit" name="format" value="csv" variant="outline">
              CSV herunterladen
            </Button>
            <Button type="submit" name="format" value="pdf" variant="outline">
              PDF herunterladen
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Aufbewahrungsfristen und löschbare Datensätze
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Fristbeginn ist das Ende des Kalenderjahres. Es wird nichts
            automatisch gelöscht — dieser Bericht zeigt, was gelöscht oder
            anonymisiert werden darf.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm
            action={updateRetention}
            successMessage="Fristen gespeichert."
            className="grid gap-4 sm:grid-cols-3 items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="retentionExpenseYears">
                Reisekosten inkl. Belege (Jahre)
              </Label>
              <Input
                id="retentionExpenseYears"
                name="retentionExpenseYears"
                type="number"
                defaultValue={settings.retentionExpenseYears}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retentionSickLeaveYears">
                Krankmeldungen (Jahre)
              </Label>
              <Input
                id="retentionSickLeaveYears"
                name="retentionSickLeaveYears"
                type="number"
                defaultValue={settings.retentionSickLeaveYears}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="retentionRequestYears">
                Urlaub/Workation (Jahre)
              </Label>
              <Input
                id="retentionRequestYears"
                name="retentionRequestYears"
                type="number"
                defaultValue={settings.retentionRequestYears}
              />
            </div>
            <Button type="submit" className="sm:col-span-3 w-fit">
              Fristen speichern
            </Button>
          </ActionForm>

          <div className="rounded-md border p-3 text-sm">
            <p className="mb-2 font-medium">
              Bericht „löschbare Datensätze“ (Stand heute):
            </p>
            <ul className="space-y-1">
              <li>
                Reisekostenabrechnungen (vor {retention.cutoffExpenses}):{" "}
                <strong>{retention.deletableExpenses}</strong>
              </li>
              <li>
                Krankmeldungen (vor {retention.cutoffSickLeaves}):{" "}
                <strong>{retention.deletableSickLeaves}</strong>
              </li>
              <li>
                Urlaubsanträge (vor {retention.cutoffRequests}):{" "}
                <strong>{retention.deletableVacations}</strong>
              </li>
              <li>
                Workation-Anträge (vor {retention.cutoffRequests}):{" "}
                <strong>{retention.deletableWorkations}</strong>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
