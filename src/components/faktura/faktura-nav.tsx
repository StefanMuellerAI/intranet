"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/faktura", label: "Zeiterfassung" },
  { href: "/faktura/freigabe", label: "Freigabe" },
  { href: "/faktura/kunden", label: "Kunden & Projekte" },
  { href: "/faktura/export", label: "Export & Stundenzettel" },
];

/** Unterbereiche des Faktura-Moduls — nur für den Admin sichtbar. */
export function FakturaNav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
      {ITEMS.map((item) => {
        const active =
          item.href === "/faktura"
            ? pathname === "/faktura"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
