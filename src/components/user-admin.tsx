"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  resendInvitation,
  setUserStatus,
  updateUserVacation,
} from "@/app/(app)/mitarbeitende/actions";

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
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Wird versendet …" : "Einladen"}
        </Button>
      </div>
    </form>
  );
}
