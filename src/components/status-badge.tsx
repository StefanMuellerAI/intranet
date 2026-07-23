import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  eingereicht: {
    label: "Eingereicht",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  genehmigt: {
    label: "Genehmigt",
    className: "bg-green-100 text-green-800 border-green-200",
  },
  beanstandet: {
    label: "Beanstandet",
    className: "bg-amber-100 text-amber-800 border-amber-200",
  },
  storno_beantragt: {
    label: "Storno beantragt",
    className: "bg-purple-100 text-purple-800 border-purple-200",
  },
  storniert: {
    label: "Storniert",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
  gemeldet: {
    label: "Gemeldet",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  abgeschlossen: {
    label: "Abgeschlossen",
    className: "bg-gray-100 text-gray-600 border-gray-200",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", s.className)}>
      {s.label}
    </Badge>
  );
}
