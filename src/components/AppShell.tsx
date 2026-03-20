"use client";

import { usePathname } from "next/navigation";

import { Navbar } from "@/components/Navbar";
import { PageTransition } from "@/components/PageTransition";

const AUTH_ROUTE_PREFIXES = ["/sign-in", "/sign-up"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideNavbar = AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  return (
    <>
      {hideNavbar ? null : <Navbar />}
      <PageTransition>{children}</PageTransition>
    </>
  );
}
