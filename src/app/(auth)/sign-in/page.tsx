"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";

type Role = "user" | "admin";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function RoleButton({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-xl border p-3 text-left transition-all duration-150",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/10 bg-background hover:border-foreground/30"
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className={cn("mt-0.5 text-xs", selected ? "opacity-60" : "text-foreground/40")}>
        {description}
      </span>
    </button>
  );
}

function Divider() {
  return <div className="h-px w-full bg-foreground/8" aria-hidden="true" />;
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M12 3.75 21 19.5H3L12 3.75Zm0 5.1v4.6m0 2.55h.01"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" className="animate-spin" aria-hidden="true">
      <path
        d="M12 3.5a8.5 8.5 0 1 1-6.01 2.49"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function SignInPage() {
  const [role, setRole] = useState<Role>("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);

    try {
      const endpoint =
        role === "admin" ? "/api/auth/admin/login" : "/api/auth/user/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      window.location.assign(role === "admin" ? "/admin" : "/inbox");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-sm"
    >
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-foreground/10 bg-foreground/5">
          <span className="font-mono text-sm font-medium">Æ</span>
        </div>
        <h1 className="mb-1 text-xl font-medium tracking-tight">Sign in</h1>
        <p className="text-sm font-light text-foreground/50">Access your Aegis workspace</p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-foreground/8 bg-surface p-6">
        <div>
          <label className="mb-2 block text-xs font-mono uppercase tracking-widest opacity-40">
            Sign in as
          </label>
          <div className="grid grid-cols-2 gap-2">
            <RoleButton
              label="User"
              description="Standard access"
              selected={role === "user"}
              onClick={() => setRole("user")}
            />
            <RoleButton
              label="Admin"
              description="Full access"
              selected={role === "admin"}
              onClick={() => setRole("admin")}
            />
          </div>
        </div>

        <Divider />

        <div>
          <label className="mb-1.5 block text-xs font-mono uppercase tracking-widest opacity-40">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2.5 text-sm transition-all duration-150 placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-mono uppercase tracking-widest opacity-40">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2.5 text-sm transition-all duration-150 placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>

        {error ? (
          <p className="flex items-center gap-1.5 text-xs text-signal-risk">
            <AlertIcon />
            <span>{error}</span>
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleSignIn()}
          disabled={loading}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-2.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-80 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Spinner />
              <span>Signing in</span>
            </>
          ) : (
            "Sign in →"
          )}
        </button>
      </div>

      <p className="mt-4 text-center text-xs opacity-40">
        No account?{" "}
        <Link href="/sign-up" className="underline underline-offset-2 transition-opacity hover:opacity-70">
          Sign up
        </Link>
      </p>
    </motion.div>
  );
}
