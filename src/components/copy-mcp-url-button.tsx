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
        await navigator.clipboard.writeText(url);
        toast.success("MCP-URL in die Zwischenablage kopiert.");
      }}
    >
      URL kopieren
    </Button>
  );
}
