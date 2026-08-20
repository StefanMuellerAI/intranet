"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createApiKey,
  revokeApiKey,
  deleteWebhook,
  toggleWebhook,
  setDeputy,
  clearDeputy,
} from "@/app/(app)/einstellungen/actions";
import {
  API_KEY_SCOPE_HINTS,
  API_KEY_SCOPE_LABELS,
  API_KEY_SCOPES,
  type ApiKeyScope,
} from "@/lib/api-scopes";

function useAction() {
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

/** Server-Action-Formular mit Toast-Fehlerbehandlung */
export function ActionForm({
  action,
  successMessage,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  successMessage: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { pending, run } = useAction();
  return (
    <form
      action={(fd) => run(() => action(fd), successMessage)}
      className={className}
      aria-busy={pending}
    >
      {children}
    </form>
  );
}

export function DeputyPanel({
  users,
  current,
}: {
  users: { id: string; name: string }[];
  current: {
    userId: string;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
  } | null;
}) {
  const { pending, run } = useAction();

  return (
    <div className="space-y-4">
      {current ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Aktive Vertretung: <strong>{current.name}</strong>
            {current.startsOn || current.endsOn
              ? ` (${current.startsOn ?? "sofort"} bis ${current.endsOn ?? "auf Widerruf"})`
              : " (ohne Zeitraum)"}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => clearDeputy(), "Vertretung entzogen.")}
          >
            Vertretung entziehen
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aktuell ist keine Vertretung aktiv.
        </p>
      )}

      <ActionForm
        action={setDeputy}
        successMessage="Vertretung aktiviert."
        className="grid gap-3 sm:grid-cols-4 items-end"
      >
        <div className="space-y-1">
          <Label htmlFor="deputy-user">Mitarbeiter/in</Label>
          <select
            id="deputy-user"
            name="userId"
            required
            className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">— wählen —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="deputy-start">Von (optional)</Label>
          <Input id="deputy-start" name="startsOn" type="date" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="deputy-end">Bis (optional, autom. Ende)</Label>
          <Input id="deputy-end" name="endsOn" type="date" />
        </div>
        <Button type="submit">Vertretung aktivieren</Button>
      </ActionForm>
    </div>
  );
}

export function WebhookRowActions({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => toggleWebhook(id, !active),
            active ? "Webhook deaktiviert." : "Webhook aktiviert."
          )
        }
      >
        {active ? "Deaktivieren" : "Aktivieren"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => deleteWebhook(id), "Webhook gelöscht.")}
      >
        Löschen
      </Button>
    </div>
  );
}

export function ApiKeyPanel({
  keys,
}: {
  keys: {
    id: string;
    name: string;
    keyPrefix: string;
    scope: ApiKeyScope;
    createdAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }[];
}) {
  const { pending, run } = useAction();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [scope, setScope] = useState<ApiKeyScope>("readonly");

  return (
    <div className="space-y-4">
      <form
        action={(fd) =>
          run(async () => {
            const key = await createApiKey(fd);
            setNewKey(key);
          }, "API-Key erstellt.")
        }
        className="flex flex-wrap items-end gap-2"
      >
        <div className="space-y-1">
          <Label htmlFor="key-name">Name / Verwendungszweck</Label>
          <Input
            id="key-name"
            name="name"
            required
            placeholder="z. B. Claude-Freigaben via n8n"
            className="w-72"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="key-scope">Berechtigung</Label>
          <select
            id="key-scope"
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ApiKeyScope)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            {API_KEY_SCOPES.map((s) => (
              <option key={s} value={s}>
                {API_KEY_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {API_KEY_SCOPE_HINTS[scope]}
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          Key erzeugen
        </Button>
      </form>

      {newKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">
            Neuer API-Key — wird nur dieses eine Mal angezeigt:
          </p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs">
            {newKey}
          </code>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(newKey);
              toast.success("In die Zwischenablage kopiert.");
            }}
          >
            Kopieren
          </Button>
        </div>
      )}

      <ul className="space-y-2 text-sm">
        {keys.map((k) => (
          <li
            key={k.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
          >
            <span>
              <strong>{k.name}</strong>{" "}
              <code className="text-xs text-muted-foreground">
                {k.keyPrefix}…
              </code>{" "}
              · {API_KEY_SCOPE_LABELS[k.scope] ?? k.scope} · erstellt{" "}
              {k.createdAt}
              {k.lastUsedAt ? ` · zuletzt genutzt ${k.lastUsedAt}` : ""}
              {k.revokedAt ? (
                <span className="text-red-600"> · widerrufen</span>
              ) : null}
            </span>
            {!k.revokedAt && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => revokeApiKey(k.id), "API-Key widerrufen.")
                }
              >
                Widerrufen
              </Button>
            )}
          </li>
        ))}
        {keys.length === 0 && (
          <li className="text-muted-foreground">Noch keine API-Keys.</li>
        )}
      </ul>
    </div>
  );
}
