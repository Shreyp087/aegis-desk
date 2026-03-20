"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/context/AuthContext";

type NavItem = {
  href: string;
  label: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isActivePath(pathname: string, href: string) {
  if (href === "/inbox") {
    return (
      pathname === "/inbox" ||
      pathname.startsWith("/inbox/") ||
      pathname === "/inbox-scanner" ||
      pathname.startsWith("/inbox-scanner/")
    );
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ href, label, pathname, onClick }: NavItem & { pathname: string; onClick?: () => void }) {
  const active = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-sm font-medium tracking-tight transition-colors duration-150",
        active ? "text-foreground" : "text-foreground/50 hover:text-foreground/80"
      )}
    >
      {label}
    </Link>
  );
}

function ThemeIcon({ isDark }: { isDark: boolean }) {
  return isDark ? (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M20 14.4A8 8 0 1 1 9.6 4a7 7 0 0 0 10.4 10.4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isDark, toggleTheme } = useTheme();
  const { user, role, loading, signOut } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const navLinks: NavItem[] = user
    ? role === "admin"
      ? [
          { href: "/admin", label: "Admin" },
          { href: "/inbox", label: "Inbox" },
          { href: "/agent", label: "Agent Desk" },
          { href: "/tickets", label: "Tickets" },
          { href: "/queueguard", label: "QueueGuard" },
        ]
      : [
          { href: "/inbox", label: "Inbox" },
          { href: "/agent", label: "Agent Desk" },
          { href: "/tickets", label: "Tickets" },
        ]
    : [];
  const showDesktopNav =
    navLinks.length > 0 && pathname !== "/" && pathname !== "/workspace";
  const leftCount = Math.floor(navLinks.length / 2);
  const leftLinks = navLinks.slice(0, leftCount);
  const rightLinks = navLinks.slice(leftCount);
  const userInitial =
    user?.name.trim().charAt(0).toUpperCase() ||
    user?.email.trim().charAt(0).toUpperCase() ||
    "A";

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const update = () => {
      nav.dataset.scrolled = String(window.scrollY > 20);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    nav.dataset.menuOpen = String(isOpen);
    document.body.style.overflow = isOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const isProfilePage = isActivePath(pathname, "/profile");
  const closeMenu = () => setIsOpen(false);

  const handleSignOut = async () => {
    closeMenu();
    await signOut();
    router.replace("/");
    router.refresh();
  };

  return (
    <nav
      key={pathname}
      ref={navRef}
      data-scrolled="false"
      data-menu-open="false"
      className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between px-4 transition-all duration-300 sm:px-6 md:px-10"
    >
      <button
        type="button"
        aria-label={isOpen ? "Close menu" : "Open menu"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        data-open={isOpen}
        className={cn(
          "group flex h-10 w-10 items-center justify-center rounded-full border border-transparent p-2 transition-all duration-150 hover:text-foreground",
          isOpen ? "bg-foreground/8 text-foreground" : "hover:bg-foreground/5"
        )}
      >
        <span className="block h-[1.5px] w-5 origin-center bg-current transition-transform duration-300 group-data-[open=true]:translate-y-[6.5px] group-data-[open=true]:rotate-45" />
        <span className="block h-[1.5px] w-5 bg-current transition-opacity duration-300 group-data-[open=true]:opacity-0" />
        <span className="block h-[1.5px] w-5 origin-center bg-current transition-transform duration-300 group-data-[open=true]:-translate-y-[6.5px] group-data-[open=true]:-rotate-45" />
      </button>

      <Link
        href="/workspace"
        className="absolute left-1/2 -translate-x-1/2 font-mono text-base font-medium tracking-[0.15em] uppercase md:hidden"
      >
        Æ AEGIS
      </Link>

      <div className="hidden flex-1 items-center justify-center md:flex">
        {showDesktopNav ? (
          <div className="grid w-full max-w-5xl grid-cols-[1fr_auto_1fr] items-center gap-8">
            <div className="flex items-center justify-end gap-8">
              {leftLinks.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}
            </div>

            <Link href="/workspace" className="font-mono text-base font-medium tracking-[0.15em] uppercase">
              Æ AEGIS
            </Link>

            <div className="flex items-center justify-start gap-8">
              {rightLinks.map((item) => (
                <NavLink key={item.href} {...item} pathname={pathname} />
              ))}
            </div>
          </div>
        ) : (
          <Link href="/workspace" className="font-mono text-base font-medium tracking-[0.15em] uppercase">
            Æ AEGIS
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/55 transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground"
        >
          <ThemeIcon isDark={isDark} />
        </button>

        {loading ? (
          <div className="hidden h-9 w-24 rounded-full bg-foreground/5 md:block" aria-hidden="true" />
        ) : user ? (
          <div className="flex items-center gap-2 md:gap-3">
            <span
              className={cn(
                "hidden rounded-full border px-2 py-1 text-xs font-mono uppercase tracking-wide md:inline-flex",
                role === "admin"
                  ? "border-signal-caution/30 bg-signal-caution/10 text-signal-caution"
                  : "border-foreground/10 text-foreground/40"
              )}
            >
              {role}
            </span>
            <Link
              href="/profile"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-mono transition-colors duration-150",
                isProfilePage
                  ? "border-foreground/20 bg-foreground/10 text-foreground"
                  : "border-foreground/10 bg-foreground/5 text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
              )}
              title="Open profile"
              aria-label="Open profile"
            >
              {userInitial}
            </Link>
          </div>
        ) : (
          <Link
            href="/sign-in"
            className="hidden items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-80 md:inline-flex"
          >
            Sign in <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>

      <div
        className={cn(
          "fixed inset-0 z-40 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          isOpen ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"
        )}
        aria-hidden={!isOpen}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeMenu}
          className="absolute inset-0 bg-transparent"
        />

        <div className="absolute left-4 top-20 bottom-4 w-[min(22rem,calc(100vw-2rem))] sm:left-6 sm:w-[22rem] md:hidden">
          <div
            className="flex h-full flex-col rounded-[1.75rem] border border-foreground/10 bg-surface/88 p-5 shadow-[0_24px_80px_rgb(15_15_18/0.18)] backdrop-blur-md"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-foreground/8 pb-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.2em] text-foreground/35">Menu</p>
                <p className="mt-1 text-sm font-light text-foreground/60">
                  {user ? "Navigate your workspace or switch tasks." : "Open the workspace or sign in."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMenu}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-background/80 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-foreground/55 transition-colors duration-150 hover:border-foreground/20 hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto pt-5">
              {navLinks.length > 0 ? (
                <>
                  <div className="flex flex-col gap-3">
                    {navLinks.map((item, index) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={closeMenu}
                        style={{ transitionDelay: isOpen ? `${index * 50}ms` : "0ms" }}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-2xl font-light tracking-tight transition-all duration-300",
                          isActivePath(pathname, item.href)
                            ? "border-foreground/16 bg-foreground/[0.06] text-foreground"
                            : "border-foreground/8 bg-background/72 text-foreground/72 hover:border-foreground/16 hover:text-foreground"
                        )}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>

                  <div className="grid gap-3 border-t border-foreground/8 pt-5">
                    <Link
                      href="/profile"
                      onClick={closeMenu}
                      className={cn(
                        "rounded-2xl border px-4 py-3 text-lg font-medium tracking-tight transition-colors duration-150",
                        isProfilePage
                          ? "border-foreground/16 bg-foreground/[0.06] text-foreground"
                          : "border-foreground/8 bg-background/72 text-foreground/70 hover:border-foreground/16 hover:text-foreground"
                      )}
                    >
                      Profile
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      className="rounded-2xl border border-foreground/8 bg-background/72 px-4 py-3 text-left text-lg font-medium tracking-tight text-foreground/60 transition-colors duration-150 hover:border-foreground/16 hover:text-foreground"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link
                    href="/sign-in"
                    onClick={closeMenu}
                    className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-foreground px-5 py-3 text-base font-medium text-background transition-opacity duration-150 hover:opacity-85"
                  >
                    Sign in <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    href="/workspace"
                    onClick={closeMenu}
                    className="rounded-2xl border border-foreground/8 bg-background/72 px-4 py-3 text-lg font-medium tracking-tight text-foreground/65 transition-colors duration-150 hover:border-foreground/16 hover:text-foreground"
                  >
                    Workspace
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

export { Navbar };
