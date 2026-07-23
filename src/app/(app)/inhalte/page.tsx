import { asc, desc } from "drizzle-orm";
import { db, helpfulLinks, newsItems } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import {
  HelpfulLinkCreateForm,
  HelpfulLinkRow,
  NewsCreateForm,
  NewsItemRow,
} from "@/components/content-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Inhalte" };

export default async function InhaltePage() {
  await requireAdmin();

  const [links, news] = await Promise.all([
    db.select().from(helpfulLinks).orderBy(asc(helpfulLinks.sortOrder), asc(helpfulLinks.title)),
    db.select().from(newsItems).orderBy(desc(newsItems.createdAt)),
  ]);

  return (
    <div>
      <PageHeader
        title="Inhalte"
        description="Hilfreiche Links und Neuigkeiten für das Mitarbeiter-Dashboard"
      />

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hilfreiche Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <HelpfulLinkCreateForm />
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Links angelegt.
              </p>
            ) : (
              <ul className="space-y-3">
                {links.map((link) => (
                  <HelpfulLinkRow key={link.id} link={link} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Neuigkeiten (Ticker)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <NewsCreateForm />
            {news.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Neuigkeiten veröffentlicht.
              </p>
            ) : (
              <ul className="space-y-3">
                {news.map((item) => (
                  <NewsItemRow
                    key={item.id}
                    item={{
                      id: item.id,
                      title: item.title,
                      body: item.body,
                      active: item.active,
                      createdLabel: item.createdAt.toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      }),
                    }}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
