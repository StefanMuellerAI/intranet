"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const OWN_ITEM = { href: "/berichte", label: "Meine Berichte" };
const ALL_ITEM = { href: "/berichte/alle", label: "Alle Berichte" };

/** Die Zitatverwaltung bleibt dem Admin vorbehalten. */
const ADMIN_ITEMS = [{ href: "/berichte/zitate", label: "Zitate" }];

export function BerichteNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items = [OWN_ITEM, ALL_ITEM, ...(isAdmin ? ADMIN_ITEMS : [])];
  const subPages = [ALL_ITEM, ...ADMIN_ITEMS];

  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1 text-sm">
      {items.map((item) => {
        const active =
          item.href === OWN_ITEM.href
            ? pathname === OWN_ITEM.href ||
              (pathname.startsWith("/berichte/") &&
                !subPages.some((sub) => pathname.startsWith(sub.href)))
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
