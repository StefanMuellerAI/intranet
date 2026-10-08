"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyMcpUrlButton({ url }: { url: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          // Ohne HTTPS oder ohne Berechtigung fehlt die Clipboard-API bzw. sie wirft
          await navigator.clipboard.writeText(url);
          toast.success("MCP-URL in die Zwischenablage kopiert.");
        } catch {
          toast.error(
            "URL konnte nicht kopiert werden — bitte manuell markieren und kopieren."
          );
        }
      }}
    >
      URL kopieren
    </Button>
  );
}
