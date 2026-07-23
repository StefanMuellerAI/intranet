"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  createHelpfulLink,
  createNewsItem,
  deleteHelpfulLink,
  deleteNewsItem,
  toggleHelpfulLink,
  toggleNewsItem,
  updateHelpfulLink,
  updateNewsItem,
} from "@/app/(app)/inhalte/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

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

function ActionForm({
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

export function HelpfulLinkCreateForm() {
  return (
    <ActionForm
      action={createHelpfulLink}
      successMessage="Link angelegt."
      className="grid gap-3 sm:grid-cols-2"
    >
      <div className="space-y-1">
        <Label htmlFor="link-title">Titel</Label>
        <Input id="link-title" name="title" required placeholder="z. B. Wiki" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link-url">URL</Label>
        <Input
          id="link-url"
          name="url"
          type="url"
          required
          placeholder="https://…"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="link-description">Beschreibung (optional)</Label>
        <Input
          id="link-description"
          name="description"
          placeholder="Kurzbeschreibung für Mitarbeitende"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link-sort">Reihenfolge</Label>
        <Input
          id="link-sort"
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={0}
        />
      </div>
      <div className="flex items-end">
        <Button type="submit">Link hinzufügen</Button>
      </div>
    </ActionForm>
  );
}

export function HelpfulLinkRow({
  link,
}: {
  link: {
    id: string;
    title: string;
    url: string;
    description: string | null;
    sortOrder: number;
    active: boolean;
  };
}) {
  const { pending, run } = useAction();

  return (
    <li className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{link.title}</p>
        <Badge variant={link.active ? "default" : "secondary"}>
          {link.active ? "sichtbar" : "ausgeblendet"}
        </Badge>
      </div>

      <ActionForm
        action={updateHelpfulLink}
        successMessage="Link aktualisiert."
        className="grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="id" value={link.id} />
        <div className="space-y-1">
          <Label htmlFor={`title-${link.id}`}>Titel</Label>
          <Input
            id={`title-${link.id}`}
            name="title"
            defaultValue={link.title}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`url-${link.id}`}>URL</Label>
          <Input
            id={`url-${link.id}`}
            name="url"
            type="url"
            defaultValue={link.url}
            required
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`desc-${link.id}`}>Beschreibung</Label>
          <Input
            id={`desc-${link.id}`}
            name="description"
            defaultValue={link.description ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`sort-${link.id}`}>Reihenfolge</Label>
          <Input
            id={`sort-${link.id}`}
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={link.sortOrder}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" size="sm" variant="outline">
            Speichern
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => toggleHelpfulLink(link.id),
                link.active ? "Link ausgeblendet." : "Link eingeblendet."
              )
            }
          >
            {link.active ? "Ausblenden" : "Einblenden"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm("Link wirklich löschen?")) return;
              run(() => deleteHelpfulLink(link.id), "Link gelöscht.");
            }}
          >
            Löschen
          </Button>
        </div>
      </ActionForm>
    </li>
  );
}

export function NewsCreateForm() {
  return (
    <ActionForm
      action={createNewsItem}
      successMessage="Neuigkeit veröffentlicht."
      className="grid gap-3"
    >
      <div className="space-y-1">
        <Label htmlFor="news-title">Titel</Label>
        <Input
          id="news-title"
          name="title"
          required
          placeholder="z. B. Büro geschlossen"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="news-body">Nachricht</Label>
        <Textarea
          id="news-body"
          name="body"
          required
          rows={3}
          placeholder="Kurzer Text für den Dashboard-Ticker"
        />
      </div>
      <div>
        <Button type="submit">Neuigkeit veröffentlichen</Button>
      </div>
    </ActionForm>
  );
}

export function NewsItemRow({
  item,
}: {
  item: {
    id: string;
    title: string;
    body: string;
    active: boolean;
    createdLabel: string;
  };
}) {
  const { pending, run } = useAction();

  return (
    <li className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{item.title}</p>
        <Badge variant={item.active ? "default" : "secondary"}>
          {item.active ? "sichtbar" : "ausgeblendet"}
        </Badge>
        <span className="text-xs text-muted-foreground">{item.createdLabel}</span>
      </div>

      <ActionForm
        action={updateNewsItem}
        successMessage="Neuigkeit aktualisiert."
        className="grid gap-3"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="space-y-1">
          <Label htmlFor={`news-title-${item.id}`}>Titel</Label>
          <Input
            id={`news-title-${item.id}`}
            name="title"
            defaultValue={item.title}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`news-body-${item.id}`}>Nachricht</Label>
          <Textarea
            id={`news-body-${item.id}`}
            name="body"
            defaultValue={item.body}
            required
            rows={3}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" variant="outline">
            Speichern
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(
                () => toggleNewsItem(item.id),
                item.active
                  ? "Neuigkeit ausgeblendet."
                  : "Neuigkeit eingeblendet."
              )
            }
          >
            {item.active ? "Ausblenden" : "Einblenden"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm("Neuigkeit wirklich löschen?")) return;
              run(() => deleteNewsItem(item.id), "Neuigkeit gelöscht.");
            }}
          >
            Löschen
          </Button>
        </div>
      </ActionForm>
    </li>
  );
}
