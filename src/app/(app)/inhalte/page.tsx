import { asc, desc, gte } from "drizzle-orm";
import { db, helpfulLinks, newsItems, teamEvents } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { formatDateDE, toISODate } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { ContentTabs } from "@/components/content-admin";

export const metadata = { title: "Inhalte" };

export default async function InhaltePage() {
  await requireAdmin();

  // Vergangene Teamevents gelten als archiviert: Sie bleiben in der
  // Datenbank (und damit im Kalender-Rückblick), werden hier aber nicht
  // mehr aufgelistet.
  const todayISO = toISODate(new Date());

  const [links, news, events] = await Promise.all([
    db.select().from(helpfulLinks).orderBy(asc(helpfulLinks.sortOrder), asc(helpfulLinks.title)),
    db.select().from(newsItems).orderBy(desc(newsItems.createdAt)),
    db
      .select()
      .from(teamEvents)
      .where(gte(teamEvents.endDate, todayISO))
      .orderBy(asc(teamEvents.startDate), asc(teamEvents.title)),
  ]);

  return (
    <div data-page-width="wide">
      <PageHeader
        title="Inhalte"
        description="Hilfreiche Links, Neuigkeiten und Teamevents für Dashboard und Kalender"
      />

      <ContentTabs
        links={links.map((link) => ({
          id: link.id,
          title: link.title,
          url: link.url,
          description: link.description,
          sortOrder: link.sortOrder,
          active: link.active,
        }))}
        news={news.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          active: item.active,
          createdLabel: item.createdAt.toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }),
        }))}
        events={events.map((event) => ({
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          active: event.active,
          rangeLabel:
            event.startDate === event.endDate
              ? formatDateDE(event.startDate)
              : `${formatDateDE(event.startDate)} – ${formatDateDE(event.endDate)}`,
        }))}
      />
    </div>
  );
}
