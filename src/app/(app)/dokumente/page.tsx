import { desc, eq } from "drizzle-orm";
import { FileText } from "lucide-react";
import { db, employeeDocuments } from "@/db";
import { requireUser } from "@/lib/auth";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/documents";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Dokumente" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DokumentePage() {
  const user = await requireUser();
  const documents = await db
    .select()
    .from(employeeDocuments)
    .where(eq(employeeDocuments.userId, user.id))
    .orderBy(desc(employeeDocuments.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meine Dokumente"
        description="Arbeitsvertrag und weitere Unterlagen — verschlüsselt gespeichert, nur für dich und die Personalverwaltung einsehbar."
      />

      <Card>
        <CardContent>
          {documents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Es sind noch keine Dokumente für dich hinterlegt.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dokument</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Größe</TableHead>
                  <TableHead>Hinterlegt am</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <a
                        href={`/api/dokumente/${doc.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 font-medium underline-offset-2 hover:underline"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {doc.title ?? doc.filename}
                      </a>
                      {doc.title && (
                        <p className="ml-6 text-xs text-muted-foreground">
                          {doc.filename}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {DOCUMENT_CATEGORY_LABELS[doc.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatSize(doc.sizeBytes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {doc.createdAt.toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
