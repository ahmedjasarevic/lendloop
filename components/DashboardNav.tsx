"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { api } from "@/convex/_generated/api";
import { Badge, cx } from "./ui";
import { Logo } from "./SiteHeader";

const LINKS = [
  { href: "/browse", label: "Board" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
];

export function DashboardNav() {
  const pathname = usePathname();
  const viewer = useQuery(api.users.viewer);

  const links = viewer?.isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:py-0">
        <div className="flex items-center justify-between gap-4">
          <Link href="/browse" aria-label="LendLoop board">
            <Logo />
          </Link>
          <div className="flex items-center gap-2 sm:hidden">
            <UserButton />
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cx(
                    "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    active
                      ? "bg-stone-900 text-white"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-2 hidden items-center gap-3 sm:flex">
            {viewer ? (
              <span className="flex items-center gap-1.5 text-xs text-stone-500">
                {viewer.name}
                {viewer.isTrustedLender ? <Badge tone="green">Trusted</Badge> : null}
                {viewer.isAdmin ? <Badge tone="blue">Admin</Badge> : null}
              </span>
            ) : null}
            <UserButton />
          </div>
        </div>
      </div>
    </header>
  );
}
