import { requireUser } from "@/lib/auth";
import { CopyMcpUrlButton } from "@/components/copy-mcp-url-button";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = { title: "Mein Konto" };

export default async function KontoPage() {
  await requireUser();

  const base =
    process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const mcpUrl = `${base}/mcp`;

  return (
    <div>
      <PageHeader
        title="Mein Konto"
        description="Persönliche Verbindungen und Hinweise zu Ihrem Intranet-Zugang."
      />

      <Card>
        <CardHeader>
          <CardTitle>Claude / Cursor verbinden (MCP)</CardTitle>
          <CardDescription>
            Die URL ist für alle Mitarbeitenden gleich. Beim Verbinden melden
            Sie sich mit Ihrem StefanAI-Konto an — Claude und Cursor dürfen
            danach nur Ihre eigenen Anträge erstellen und verwalten, keine
            Dokumente und keine Anträge anderer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-medium">MCP-Server-URL</p>
            <code className="block break-all rounded-md border bg-muted/40 p-3 text-xs">
              {mcpUrl}
            </code>
            <div className="mt-2">
              <CopyMcpUrlButton url={mcpUrl} />
            </div>
          </div>

          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>URL kopieren.</li>
            <li>
              In Claude (Desktop / claude.ai) oder Cursor einen Remote-MCP-Server
              mit dieser URL hinzufügen.
            </li>
            <li>
              Im Browser-Fenster mit Ihrem Intranet-Konto anmelden und den
              Zugriff bestätigen.
            </li>
            <li>
              Anschließend können Sie z.&nbsp;B. Urlaub, Workation, Reisekosten,
              Provision oder Krankmeldung per Chat einreichen lassen.
            </li>
          </ol>

          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            Datenschutz: Es werden keine Mitarbeiterdokumente (Arbeitsverträge
            etc.) über MCP freigegeben. Reisekosten-Belege bitte weiterhin im
            Web-Formular hochladen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
