"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import {
  CalendarDays,
  CheckSquare,
  HandCoins,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Palmtree,
  Plane,
  Receipt,
  Settings,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface SidebarProps {
  userName: string;
  roleLabel: string;
  isAdmin: boolean;
  canApprove: boolean;
  openApprovals: number;
}

export function Sidebar({
  userName,
  roleLabel,
  isAdmin,
  canApprove,
  openApprovals,
}: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { signOut } = useClerk();

  const items = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/urlaub", label: "Urlaub", icon: Palmtree },
    { href: "/workation", label: "Workation", icon: Plane },
    { href: "/reisekosten", label: "Reisekosten", icon: Receipt },
    { href: "/provision", label: "Provisionen", icon: HandCoins },
    { href: "/krankmeldung", label: "Krankmeldung", icon: HeartPulse },
    { href: "/kalender", label: "Kalender", icon: CalendarDays },
    ...(canApprove
      ? [
          {
            href: "/freigaben",
            label: "Freigaben",
            icon: CheckSquare,
            badge: openApprovals,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          { href: "/mitarbeitende", label: "Mitarbeitende", icon: Users },
          { href: "/einstellungen", label: "Einstellungen", icon: Settings },
        ]
      : []),
  ];

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {"badge" in item && item.badge && item.badge > 0 ? (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto border-t p-4">
      <p className="text-sm font-medium">{userName}</p>
      <p className="text-xs text-muted-foreground">{roleLabel}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() => signOut({ redirectUrl: "/anmelden" })}
      >
        <LogOut className="mr-2 h-4 w-4" /> Abmelden
      </Button>
    </div>
  );

  return (
    <>
      {/* Mobile Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 md:hidden">
        <span className="flex items-center gap-2 font-semibold">
          <Image
            src="/logo.png"
            alt="StefanAI Logo"
            width={28}
            height={28}
            className="dark:invert"
          />
          StefanAI Intranet
        </span>
        <Button variant="ghost" size="icon" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col border-b bg-background md:hidden">
          {nav}
          {footer}
        </div>
      )}
      {/* Desktop Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex md:min-h-screen">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <Image
            src="/logo.png"
            alt="StefanAI Logo"
            width={36}
            height={36}
            className="shrink-0 dark:invert"
          />
          <div>
            <p className="font-semibold leading-tight">StefanAI Intranet</p>
            <p className="text-xs text-muted-foreground">
              StefanAI Solutions GmbH
            </p>
          </div>
        </div>
        {nav}
        {footer}
      </aside>
    </>
  );
}
