"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  calcCommissionCents,
  TRAINING_FORMAT_LABELS,
  type BusinessType,
  type CommissionRates,
  type CommissionUnit,
  type CustomerType,
  type TrainingFormat,
} from "@/lib/commissions/calc";
import { formatEuro } from "@/lib/expenses/calc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { DECIMAL_PATTERN, DECIMAL_TITLE } from "@/lib/form-patterns";

export interface CommissionFormDefaults {
  businessType?: BusinessType;
  customerType?: CustomerType;
  customerName?: string;
  orderDate?: string;
  unit?: CommissionUnit;
  quantity?: number;
  trainingFormat?: TrainingFormat;
  trainingCount?: number;
  netOrderValue?: string; // Euro als Text, z. B. "1000,00"
  note?: string;
}

function parseEuro(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function CommissionForm({
  action,
  rates,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  rates: CommissionRates;
  defaults?: CommissionFormDefaults;
  submitLabel: string;
}) {
  const [businessType, setBusinessType] = useState<BusinessType>(
    defaults?.businessType ?? "schulung"
  );
  const [customerType, setCustomerType] = useState<CustomerType>(
    defaults?.customerType ?? "bestandskunde"
  );
  const [trainingFormat, setTrainingFormat] = useState<TrainingFormat | "">(
    defaults?.trainingFormat ?? ""
  );
  const [trainingCount, setTrainingCount] = useState(
    defaults?.trainingCount != null ? String(defaults.trainingCount) : "1"
  );
  const [netOrderValue, setNetOrderValue] = useState(
    defaults?.netOrderValue ?? ""
  );
  const [unit, setUnit] = useState<CommissionUnit>(defaults?.unit ?? "tage");
  const [pending, startTransition] = useTransition();

  const preview = useMemo(() => {
    if (businessType === "schulung") {
      if (!trainingFormat) return null;
      return calcCommissionCents(
        {
          businessType,
          trainingFormat,
          trainingCount: Number(trainingCount) || 0,
        },
        rates
      );
    }
    const cents = parseEuro(netOrderValue);
    if (cents == null) return null;
    return calcCommissionCents(
      { businessType, netOrderValueCents: cents },
      rates
    );
  }, [businessType, trainingFormat, trainingCount, netOrderValue, rates]);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await action(formData);
      } catch (err) {
        if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) {
          toast.error(err.message);
          return;
        }
        throw err;
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6 max-w-xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Art des Folgegeschäfts</Label>
          <Select
            value={businessType}
            onValueChange={(v) => setBusinessType(v as BusinessType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="schulung">Schulung (Folge-Training)</SelectItem>
              <SelectItem value="beratung">Beratung (Folgeberatung)</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="businessType" value={businessType} />
        </div>
        <div className="space-y-2">
          <Label>Kundenart</Label>
          <Select
            value={customerType}
            onValueChange={(v) => setCustomerType(v as CustomerType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bestandskunde">
                Bestandskunde / über Partner
              </SelectItem>
              <SelectItem value="neukunde">Komplett neuer Kunde</SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="customerType" value={customerType} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="customerName">Kunde / Organisation</Label>
          <Input
            id="customerName"
            name="customerName"
            required
            placeholder="z. B. Haufe Akademie, dbb"
            defaultValue={defaults?.customerName ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="orderDate">Datum der Bestellung</Label>
          <Input
            id="orderDate"
            name="orderDate"
            type="date"
            required
            defaultValue={defaults?.orderDate ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Einheit</Label>
          <Select
            value={unit}
            onValueChange={(v) => setUnit(v as CommissionUnit)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tage">Tage</SelectItem>
              <SelectItem value="liefergegenstaende">
                Liefergegenstände
              </SelectItem>
            </SelectContent>
          </Select>
          <input type="hidden" name="unit" value={unit} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="quantity">
            Umfang ({unit === "tage" ? "Tage" : "Anzahl Liefergegenstände"})
          </Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            step="0.5"
            min="0.5"
            required
            defaultValue={defaults?.quantity ?? ""}
          />
        </div>
      </div>

      {businessType === "schulung" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Trainingsformat</Label>
            <Select
              value={trainingFormat || undefined}
              onValueChange={(v) => setTrainingFormat(v as TrainingFormat)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Format wählen" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="halbtaegig">
                  {TRAINING_FORMAT_LABELS.halbtaegig} —{" "}
                  {formatEuro(rates.halfDayCents)} je Training
                </SelectItem>
                <SelectItem value="ganztaegig">
                  {TRAINING_FORMAT_LABELS.ganztaegig} —{" "}
                  {formatEuro(rates.fullDayCents)} je Training
                </SelectItem>
                <SelectItem value="zweitaegig">
                  {TRAINING_FORMAT_LABELS.zweitaegig} —{" "}
                  {formatEuro(rates.twoDayCents)} je Training
                </SelectItem>
                <SelectItem value="abweichend">
                  {TRAINING_FORMAT_LABELS.abweichend}
                </SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="trainingFormat" value={trainingFormat} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trainingCount">
              Anzahl zusätzlich bestellter Trainings
            </Label>
            <Input
              id="trainingCount"
              name="trainingCount"
              type="number"
              min="1"
              step="1"
              required
              value={trainingCount}
              onChange={(e) => setTrainingCount(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="netOrderValue">
            Nettoauftragswert der Beratungsleistung (€, ohne USt., Reise-,
            Material- und Fremdleistungskosten)
          </Label>
          <Input
            id="netOrderValue"
            name="netOrderValue"
            inputMode="decimal"
            pattern={DECIMAL_PATTERN}
            title={DECIMAL_TITLE}
            required
            placeholder="z. B. 5000,00"
            value={netOrderValue}
            onChange={(e) => setNetOrderValue(e.target.value)}
          />
        </div>
      )}

      {preview != null && (
        <Alert>
          <AlertTitle>
            Berechneter Provisionsanspruch: {formatEuro(preview)}
          </AlertTitle>
          <AlertDescription>
            {businessType === "beratung"
              ? `${rates.consultingPercent} % vom Nettoauftragswert.`
              : "Je zusätzlich bestelltem Training gemäß Format."}{" "}
            Der finale Betrag wird bei der Freigabe bestätigt.
          </AlertDescription>
        </Alert>
      )}

      {businessType === "schulung" && trainingFormat === "abweichend" && (
        <Alert>
          <AlertTitle>Abweichendes Trainingsformat</AlertTitle>
          <AlertDescription>
            Für Formate über zweitägige Trainings hinaus wird eine angemessene
            Pauschalvergütung gesondert vereinbart. Der Betrag wird bei der
            Freigabe eingetragen.
          </AlertDescription>
        </Alert>
      )}

      {customerType === "neukunde" && (
        <Alert>
          <AlertTitle>Neukunden-Vermittlung</AlertTitle>
          <AlertDescription>
            Bei Projekten, die Sie von externen Interessenten an StefanAI
            weiterleiten, kann ergänzend eine Vermittlungsprovision vereinbart
            werden. Die Höhe wird im Einzelfall abgestimmt und bei der Freigabe
            eingetragen.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="note">Bemerkung (optional)</Label>
        <Textarea
          id="note"
          name="note"
          placeholder="z. B. Auftrags-/Projektbezug, Ansprechpartner"
          defaultValue={defaults?.note ?? ""}
        />
      </div>

      <Button
        type="submit"
        disabled={pending || (businessType === "schulung" && !trainingFormat)}
      >
        {pending ? "Wird eingereicht …" : submitLabel}
      </Button>
    </form>
  );
}
