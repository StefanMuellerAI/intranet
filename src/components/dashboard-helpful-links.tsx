import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardHelpfulLinks({
  links,
}: {
  links: {
    id: string;
    title: string;
    url: string;
    description: string | null;
  }[];
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Hilfreiche Links</CardTitle>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aktuell keine Links hinterlegt.
          </p>
        ) : (
          <ul className="space-y-3">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-start gap-2 text-sm"
                >
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span>
                    <span className="font-medium underline underline-offset-4">
                      {link.title}
                    </span>
                    {link.description ? (
                      <span className="mt-0.5 block text-muted-foreground no-underline">
                        {link.description}
                      </span>
                    ) : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
