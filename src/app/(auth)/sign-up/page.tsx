"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState } from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function RoleButton({
  label,
  description,
  selected,
}: {
  label: string;
  description: string;
  selected: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start rounded-xl border p-3 text-left",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/10 bg-background"
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className={cn("mt-0.5 text-xs", selected ? "opacity-60" : "text-foreground/40")}>
        {description}
      </span>
    </div>
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

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/user/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, email, password }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      window.location.assign("/inbox");
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
        <h1 className="mb-1 text-xl font-medium tracking-tight">Sign up</h1>
        <p className="text-sm font-light text-foreground/50">Create a standard Aegis operator account</p>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-foreground/8 bg-surface p-6">
        <div>
          <label className="mb-2 block text-xs font-mono uppercase tracking-widest opacity-40">
            Account type
          </label>
          <RoleButton label="User" description="Standard workspace access" selected />
          <p className="mt-2 text-xs font-light text-foreground/60">
            Admin accounts are provisioned separately.
          </p>
        </div>

        <Divider />

        <div>
          <label className="mb-1.5 block text-xs font-mono uppercase tracking-widest opacity-40">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-foreground/10 bg-background px-3 py-2.5 text-sm transition-all duration-150 placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>

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

        <div>
          <label className="mb-1.5 block text-xs font-mono uppercase tracking-widest opacity-40">
            Confirm password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
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
          onClick={() => void handleSignUp()}
          disabled={loading}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-foreground py-2.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-80 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Spinner />
              <span>Creating account</span>
            </>
          ) : (
            "Create account →"
          )}
        </button>
      </div>

      <p className="mt-4 text-center text-xs opacity-40">
        Already have access?{" "}
        <Link href="/sign-in" className="underline underline-offset-2 transition-opacity hover:opacity-70">
          Sign in
        </Link>
      </p>
    </motion.div>
  );
}
