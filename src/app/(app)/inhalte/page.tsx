import { asc, desc, gte } from "drizzle-orm";
import { db, helpfulLinks, newsItems, salesNews, teamEvents, users } from "@/db";
import { fullName, requireAdmin } from "@/lib/auth";
import { SALES_NEWS_DASHBOARD_DAYS } from "@/lib/content";
import { formatDateDE, toISODate } from "@/lib/dates";
import { formatEuro } from "@/lib/expenses/calc";
import { PageHeader } from "@/components/page-header";
import { ContentTabs } from "@/components/content-admin";

export const metadata = { title: "Inhalte" };

export default async function InhaltePage() {
  await requireAdmin();

  // Vergangene Teamevents gelten als archiviert: Sie bleiben in der
  // Datenbank (und damit im Kalender-Rückblick), werden hier aber nicht
  // mehr aufgelistet.
  const now = new Date();
  const todayISO = toISODate(now);

  const [links, news, events, sales, allUsers] = await Promise.all([
    db.select().from(helpfulLinks).orderBy(asc(helpfulLinks.sortOrder), asc(helpfulLinks.title)),
    db.select().from(newsItems).orderBy(desc(newsItems.createdAt)),
    db
      .select()
      .from(teamEvents)
      .where(gte(teamEvents.endDate, todayISO))
      .orderBy(asc(teamEvents.startDate), asc(teamEvents.title)),
    db.select().from(salesNews).orderBy(desc(salesNews.createdAt)),
    db.select().from(users).orderBy(asc(users.lastName), asc(users.firstName)),
  ]);

  const userById = new Map(allUsers.map((u) => [u.id, u]));

  return (
    <div>
      <PageHeader
        title="Inhalte"
        description="Hilfreiche Links, Neuigkeiten, Teamevents und Sales-Nachrichten für Dashboard und Kalender"
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
        sales={sales.map((item) => {
          const seller = userById.get(item.soldById);
          const dashboardUntil = new Date(
            item.createdAt.getTime() +
              SALES_NEWS_DASHBOARD_DAYS * 24 * 60 * 60 * 1000
          );
          return {
            id: item.id,
            customerName: item.customerName,
            volumeEuro: (item.volumeCents / 100).toString(),
            volumeLabel: formatEuro(item.volumeCents),
            soldById: item.soldById,
            soldByName: seller ? fullName(seller) : "Unbekannt",
            deliveryStart: item.deliveryStart,
            deliveryEnd: item.deliveryEnd,
            deliveryLabel:
              item.deliveryStart === item.deliveryEnd
                ? formatDateDE(item.deliveryStart)
                : `${formatDateDE(item.deliveryStart)} – ${formatDateDE(item.deliveryEnd)}`,
            active: item.active,
            dashboardUntilLabel:
              dashboardUntil.getTime() >= now.getTime()
                ? dashboardUntil.toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })
                : null,
          };
        })}
        employees={allUsers.map((u) => ({
          id: u.id,
          name: fullName(u),
          selectable: u.status !== "deaktiviert",
        }))}
      />
    </div>
  );
}
