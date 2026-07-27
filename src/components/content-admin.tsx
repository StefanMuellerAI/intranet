"use client";

import { Pencil, Plus } from "lucide-react";
import {
  createHelpfulLink,
  createNewsItem,
  createTeamEvent,
  deleteHelpfulLink,
  deleteNewsItem,
  deleteTeamEvent,
  toggleHelpfulLink,
  toggleNewsItem,
  toggleTeamEvent,
  updateHelpfulLink,
  updateNewsItem,
  updateTeamEvent,
} from "@/app/(app)/inhalte/actions";
import {
  DeleteDialog,
  FormDialog,
  RowActions,
  TabSection,
  VisibilityBadge,
  VisibilityToggle,
  createTrigger,
  editTrigger,
} from "@/components/admin-ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export type HelpfulLinkView = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
};

export type NewsItemView = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdLabel: string;
};

export type TeamEventView = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  active: boolean;
  rangeLabel: string;
};

// ---------------------------------------------------------------------------
// Formularfelder — von Anlegen- und Bearbeiten-Dialog gemeinsam genutzt
// ---------------------------------------------------------------------------

function HelpfulLinkFields({
  idPrefix,
  link,
}: {
  idPrefix: string;
  link?: HelpfulLinkView;
}) {
  return (
    <>
      {link && <input type="hidden" name="id" value={link.id} />}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-title`}>Titel</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          required
          defaultValue={link?.title}
          placeholder="z. B. Wiki"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-url`}>URL</Label>
        <Input
          id={`${idPrefix}-url`}
          name="url"
          type="url"
          required
          defaultValue={link?.url}
          placeholder="https://…"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-description`}>
          Beschreibung (optional)
        </Label>
        <Input
          id={`${idPrefix}-description`}
          name="description"
          defaultValue={link?.description ?? ""}
          placeholder="Kurzbeschreibung für Mitarbeitende"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-sort`}>Reihenfolge</Label>
        <Input
          id={`${idPrefix}-sort`}
          name="sortOrder"
          type="number"
          min={0}
          defaultValue={link?.sortOrder ?? 0}
        />
      </div>
    </>
  );
}

function NewsFields({
  idPrefix,
  item,
}: {
  idPrefix: string;
  item?: NewsItemView;
}) {
  return (
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-title`}>Titel</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          required
          defaultValue={item?.title}
          placeholder="z. B. Büro geschlossen"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-body`}>Nachricht</Label>
        <Textarea
          id={`${idPrefix}-body`}
          name="body"
          required
          rows={3}
          defaultValue={item?.body}
          placeholder="Kurzer Text für den Dashboard-Ticker"
        />
      </div>
    </>
  );
}

function TeamEventFields({
  idPrefix,
  event,
}: {
  idPrefix: string;
  event?: TeamEventView;
}) {
  return (
    <>
      {event && <input type="hidden" name="id" value={event.id} />}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-title`}>Titel</Label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          required
          defaultValue={event?.title}
          placeholder="z. B. Sommerfest"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-start`}>Startdatum</Label>
        <Input
          id={`${idPrefix}-start`}
          name="startDate"
          type="date"
          required
          defaultValue={event?.startDate}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-end`}>Enddatum (optional)</Label>
        <Input
          id={`${idPrefix}-end`}
          name="endDate"
          type="date"
          defaultValue={event?.endDate}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hilfreiche Links
// ---------------------------------------------------------------------------

function HelpfulLinksTable({ links }: { links: HelpfulLinkView[] }) {
  return (
    <TabSection
      hint="Werden auf dem Dashboard als Schnellzugriff angezeigt — sortiert nach Reihenfolge."
      isEmpty={links.length === 0}
      emptyLabel="Noch keine Links angelegt."
      columns={
        <>
          <TableHead className="w-16 pl-4 text-right">Nr.</TableHead>
          <TableHead>Titel</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Beschreibung</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-32 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      createAction={
        <FormDialog
          trigger={createTrigger}
          triggerLabel={
            <>
              <Plus className="h-4 w-4" />
              Neuer Link
            </>
          }
          title="Hilfreichen Link anlegen"
          description="Der Link erscheint anschließend auf dem Dashboard."
          action={createHelpfulLink}
          successMessage="Link angelegt."
          submitLabel="Link hinzufügen"
        >
          <HelpfulLinkFields idPrefix="link" />
        </FormDialog>
      }
    >
      {links.map((link) => (
        <TableRow key={link.id}>
          <TableCell className="pl-4 text-right tabular-nums text-muted-foreground">
            {link.sortOrder}
          </TableCell>
          <TableCell className="font-medium">{link.title}</TableCell>
          <TableCell>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="block max-w-[16rem] truncate text-muted-foreground underline underline-offset-2 hover:text-foreground 2xl:max-w-[26rem]"
            >
              {link.url}
            </a>
          </TableCell>
          <TableCell>
            <span className="block max-w-[18rem] truncate text-muted-foreground 2xl:max-w-[30rem]">
              {link.description || "—"}
            </span>
          </TableCell>
          <TableCell>
            <VisibilityBadge active={link.active} />
          </TableCell>
          <TableCell className="pr-4">
            <RowActions>
              <VisibilityToggle
                active={link.active}
                action={() => toggleHelpfulLink(link.id)}
                hiddenMessage="Link ausgeblendet."
                shownMessage="Link eingeblendet."
              />
              <FormDialog
                trigger={editTrigger}
                triggerLabel={<Pencil className="h-4 w-4" />}
                title="Link bearbeiten"
                action={updateHelpfulLink}
                successMessage="Link aktualisiert."
                submitLabel="Speichern"
              >
                <HelpfulLinkFields idPrefix={`link-${link.id}`} link={link} />
              </FormDialog>
              <DeleteDialog
                entityLabel="Link"
                itemTitle={link.title}
                action={() => deleteHelpfulLink(link.id)}
                successMessage="Link gelöscht."
              />
            </RowActions>
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

// ---------------------------------------------------------------------------
// Neuigkeiten
// ---------------------------------------------------------------------------

function NewsTable({ news }: { news: NewsItemView[] }) {
  return (
    <TabSection
      hint="Laufen als Ticker über das Dashboard — die zehn neuesten sichtbaren Einträge."
      isEmpty={news.length === 0}
      emptyLabel="Noch keine Neuigkeiten veröffentlicht."
      columns={
        <>
          <TableHead className="pl-4">Titel</TableHead>
          <TableHead>Nachricht</TableHead>
          <TableHead className="w-32">Veröffentlicht</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-32 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      createAction={
        <FormDialog
          trigger={createTrigger}
          triggerLabel={
            <>
              <Plus className="h-4 w-4" />
              Neue Neuigkeit
            </>
          }
          title="Neuigkeit veröffentlichen"
          description="Der Text läuft anschließend im Dashboard-Ticker."
          action={createNewsItem}
          successMessage="Neuigkeit veröffentlicht."
          submitLabel="Neuigkeit veröffentlichen"
        >
          <NewsFields idPrefix="news" />
        </FormDialog>
      }
    >
      {news.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="pl-4 font-medium">{item.title}</TableCell>
          <TableCell>
            <span className="block max-w-[28rem] truncate text-muted-foreground 2xl:max-w-[44rem]">
              {item.body}
            </span>
          </TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {item.createdLabel}
          </TableCell>
          <TableCell>
            <VisibilityBadge active={item.active} />
          </TableCell>
          <TableCell className="pr-4">
            <RowActions>
              <VisibilityToggle
                active={item.active}
                action={() => toggleNewsItem(item.id)}
                hiddenMessage="Neuigkeit ausgeblendet."
                shownMessage="Neuigkeit eingeblendet."
              />
              <FormDialog
                trigger={editTrigger}
                triggerLabel={<Pencil className="h-4 w-4" />}
                title="Neuigkeit bearbeiten"
                action={updateNewsItem}
                successMessage="Neuigkeit aktualisiert."
                submitLabel="Speichern"
              >
                <NewsFields idPrefix={`news-${item.id}`} item={item} />
              </FormDialog>
              <DeleteDialog
                entityLabel="Neuigkeit"
                itemTitle={item.title}
                action={() => deleteNewsItem(item.id)}
                successMessage="Neuigkeit gelöscht."
              />
            </RowActions>
          </TableCell>
        </TableRow>
      ))}
    </TabSection>
  );
}

// ---------------------------------------------------------------------------
// Teamevents
// ---------------------------------------------------------------------------

function TeamEventsTable({ events }: { events: TeamEventView[] }) {
  return (
    <TabSection
      hint="Erscheinen ganztägig im Abwesenheitskalender und im Kurzbriefing."
      isEmpty={events.length === 0}
      emptyLabel="Keine anstehenden Teamevents."
      columns={
        <>
          <TableHead className="pl-4">Titel</TableHead>
          <TableHead>Zeitraum</TableHead>
          <TableHead className="w-32">Status</TableHead>
          <TableHead className="w-32 pr-4 text-right">Aktionen</TableHead>
        </>
      }
      note="Vergangene Teamevents werden hier automatisch ausgeblendet, bleiben aber im Kalender sichtbar."
      createAction={
        <FormDialog
          trigger={createTrigger}
          triggerLabel={
            <>
              <Plus className="h-4 w-4" />
              Neues Teamevent
            </>
          }
          title="Teamevent anlegen"
          description="Ohne Enddatum gilt das Event als eintägig."
          action={createTeamEvent}
          successMessage="Teamevent angelegt."
          submitLabel="Teamevent hinzufügen"
        >
          <TeamEventFields idPrefix="event" />
        </FormDialog>
      }
    >
      {events.map((event) => (
        <TableRow key={event.id}>
          <TableCell className="pl-4 font-medium">{event.title}</TableCell>
          <TableCell className="tabular-nums text-muted-foreground">
            {event.rangeLabel}
          </TableCell>
          <TableCell>
            <VisibilityBadge active={event.active} />
          </TableCell>
          <TableCell className="pr-4">
            <RowActions>
              <VisibilityToggle
                active={event.active}
                action={() => toggleTeamEvent(event.id)}
                hiddenMessage="Teamevent ausgeblendet."
                shownMessage="Teamevent eingeblendet."
              />
              <FormDialog
                trigger={editTrigger}
                triggerLabel={<Pencil className="h-4 w-4" />}
                title="Teamevent bearbeiten"
                action={updateTeamEvent}
                successMessage="Teamevent aktualisiert."
                submitLabel="Speichern"
              >
                <TeamEventFields idPrefix={`event-${event.id}`} event={event} />
              </FormDialog>
              <DeleteDialog
                entityLabel="Teamevent"
                itemTitle={event.title}
                action={() => deleteTeamEvent(event.id)}
                successMessage="Teamevent gelöscht."
              />
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

export function ContentTabs({
  links,
  news,
  events,
}: {
  links: HelpfulLinkView[];
  news: NewsItemView[];
  events: TeamEventView[];
}) {
  return (
    <Tabs defaultValue="links" className="gap-6">
      <TabsList>
        <TabsTrigger value="links">
          Hilfreiche Links
          <span className="tabular-nums text-muted-foreground">
            {links.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="news">
          Neuigkeiten
          <span className="tabular-nums text-muted-foreground">
            {news.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="events">
          Teamevents
          <span className="tabular-nums text-muted-foreground">
            {events.length}
          </span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="links">
        <HelpfulLinksTable links={links} />
      </TabsContent>
      <TabsContent value="news">
        <NewsTable news={news} />
      </TabsContent>
      <TabsContent value="events">
        <TeamEventsTable events={events} />
      </TabsContent>
    </Tabs>
  );
}
