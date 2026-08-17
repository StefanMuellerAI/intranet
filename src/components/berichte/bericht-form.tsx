"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DURATION_DAYS_PATTERN,
  DURATION_DAYS_TITLE,
  FEEDBACK_RATINGS,
  FEEDBACK_RATING_LABELS,
  QUOTES_MAX_COUNT,
  QUOTE_MAX_LENGTH,
  SEMINAR_REPORT_KIND_LABELS,
  parseDurationDays,
  type FeedbackRating,
  type SeminarReportKind,
} from "@/lib/seminar-reports";
import type { ActionResult } from "@/lib/user-error";
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

export interface BerichtFormDefaults {
  kind?: SeminarReportKind;
  customerName?: string;
  title?: string;
  eventDate?: string;
  /** Dauer als Text mit deutschem Komma, z. B. "0,5" */
  durationDays?: string;
  whatWentWell?: string;
  whatWentBadly?: string;
  improvements?: string;
  feedbackRating?: number;
  quotes?: { id: string; quote: string }[];
}

interface QuoteRow {
  /** Stabiler Schlüssel für die Liste — neue Zeilen haben noch keine Id. */
  key: string;
  id: string | null;
  text: string;
}

function initialQuotes(defaults?: BerichtFormDefaults): QuoteRow[] {
  if (!defaults?.quotes?.length)
    return [{ key: crypto.randomUUID(), id: null, text: "" }];
  return defaults.quotes.map((quote) => ({
    key: quote.id,
    id: quote.id,
    text: quote.quote,
  }));
}

export function BerichtForm({
  action,
  customerSuggestions,
  defaults,
  submitLabel,
  successMessage,
}: {
  action: (formData: FormData) => Promise<ActionResult<null> | void>;
  customerSuggestions: string[];
  defaults?: BerichtFormDefaults;
  submitLabel: string;
  /** Gesetzt, wenn die Aktion auf der Seite bleibt (Bearbeiten). */
  successMessage?: string;
}) {
  const [kind, setKind] = useState<SeminarReportKind>(
    defaults?.kind ?? "seminar"
  );
  const [feedbackRating, setFeedbackRating] = useState<FeedbackRating | "">(
    (defaults?.feedbackRating as FeedbackRating | undefined) ?? ""
  );
  const [quotes, setQuotes] = useState<QuoteRow[]>(() =>
    initialQuotes(defaults)
  );
  const [pending, startTransition] = useTransition();

  const filledQuotes = quotes.filter((quote) => quote.text.trim().length > 0);

  function updateQuote(key: string, text: string) {
    setQuotes((rows) =>
      rows.map((row) => (row.key === key ? { ...row, text } : row))
    );
  }

  function removeQuote(key: string) {
    setQuotes((rows) => {
      const rest = rows.filter((row) => row.key !== key);
      // Mindestens eine Zeile bleibt stehen, damit das Feld sichtbar ist.
      return rest.length > 0
        ? rest
        : [{ key: crypto.randomUUID(), id: null, text: "" }];
    });
  }

  function addQuote() {
    setQuotes((rows) => [
      ...rows,
      { key: crypto.randomUUID(), id: null, text: "" },
    ]);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        const text = (field: string) =>
          String(formData.get(field) ?? "").trim();

        const payload = {
          kind,
          customerName: text("customerName"),
          title: text("title"),
          eventDate: text("eventDate"),
          durationDays: parseDurationDays(text("durationDays")),
          whatWentWell: text("whatWentWell"),
          whatWentBadly: text("whatWentBadly"),
          improvements: text("improvements"),
          feedbackRating: feedbackRating === "" ? null : Number(feedbackRating),
          // Leere Zeilen verwerfen — sie sind nur Platzhalter im Formular.
          quotes: filledQuotes.map((quote) => ({
            id: quote.id,
            quote: quote.text.trim(),
          })),
        };
        formData.set("payload", JSON.stringify(payload));

        const result = await action(formData);
        if (result && !result.ok) {
          toast.error(result.error);
          return;
        }
        if (successMessage) toast.success(successMessage);
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
    <form action={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Art der Veranstaltung</Label>
          <Select
            value={kind}
            onValueChange={(value) => setKind(String(value) as SeminarReportKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seminar">
                {SEMINAR_REPORT_KIND_LABELS.seminar}
              </SelectItem>
              <SelectItem value="beratung">
                {SEMINAR_REPORT_KIND_LABELS.beratung}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customerName">Kunde / Organisation</Label>
          <Input
            id="customerName"
            name="customerName"
            list="berichte-kunden"
            required
            maxLength={200}
            autoComplete="off"
            placeholder="z. B. Haufe Akademie"
            defaultValue={defaults?.customerName ?? ""}
          />
          <datalist id="berichte-kunden">
            {customerSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Titel der Veranstaltung</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          placeholder="z. B. KI-Grundlagen für Führungskräfte"
          defaultValue={defaults?.title ?? ""}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="eventDate">Datum</Label>
          <Input
            id="eventDate"
            name="eventDate"
            type="date"
            required
            defaultValue={defaults?.eventDate ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="durationDays">Dauer in Tagen</Label>
          <Input
            id="durationDays"
            name="durationDays"
            inputMode="decimal"
            pattern={DURATION_DAYS_PATTERN}
            title={DURATION_DAYS_TITLE}
            required
            placeholder="z. B. 0,5"
            defaultValue={defaults?.durationDays ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            halbtägig 0,5 · ganztägig 1 · zweitägig 2
          </p>
        </div>
        <div className="space-y-2">
          <Label>Feedback der Teilnehmenden</Label>
          <Select
            value={feedbackRating === "" ? undefined : String(feedbackRating)}
            onValueChange={(value) =>
              setFeedbackRating(Number(value) as FeedbackRating)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Bewertung wählen" />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_RATINGS.map((rating) => (
                <SelectItem key={rating} value={String(rating)}>
                  {FEEDBACK_RATING_LABELS[rating]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="whatWentWell">Was lief gut?</Label>
        <Textarea
          id="whatWentWell"
          name="whatWentWell"
          required
          rows={4}
          maxLength={4000}
          defaultValue={defaults?.whatWentWell ?? ""}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="whatWentBadly">Was lief nicht gut?</Label>
        <Textarea
          id="whatWentBadly"
          name="whatWentBadly"
          required
          rows={4}
          maxLength={4000}
          defaultValue={defaults?.whatWentBadly ?? ""}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="improvements">
          Was möchten Sie beim nächsten Mal verbessern?
        </Label>
        <Textarea
          id="improvements"
          name="improvements"
          required
          rows={4}
          maxLength={4000}
          defaultValue={defaults?.improvements ?? ""}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <Label>Zitate von Teilnehmenden (optional)</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Bitte nur den Wortlaut erfassen — keine Namen und keine Angaben, die
            Rückschlüsse auf einzelne Personen zulassen. Freigegebene Zitate
            können später auf der Website verwendet werden.
          </p>
        </div>

        {quotes.map((quote, position) => (
          <div key={quote.key} className="flex items-start gap-2">
            <Textarea
              aria-label={`Zitat ${position + 1}`}
              rows={2}
              maxLength={QUOTE_MAX_LENGTH}
              placeholder="z. B. Sehr praxisnah, ich nehme viel mit."
              value={quote.text}
              onChange={(event) => updateQuote(quote.key, event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Zitat ${position + 1} entfernen`}
              title="Zitat entfernen"
              className="mt-1 text-muted-foreground hover:text-foreground"
              onClick={() => removeQuote(quote.key)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={quotes.length >= QUOTES_MAX_COUNT}
            onClick={addQuote}
          >
            <Plus className="mr-2 h-4 w-4" /> Zitat hinzufügen
          </Button>
          <span className="text-xs text-muted-foreground">
            {filledQuotes.length} von höchstens {QUOTES_MAX_COUNT} Zitaten
          </span>
        </div>
      </div>

      <Button type="submit" disabled={pending || feedbackRating === ""}>
        {pending ? "Wird gespeichert …" : submitLabel}
      </Button>
    </form>
  );
}
