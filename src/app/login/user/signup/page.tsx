"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";

export default function UserSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        profile?: { role?: "user" | "admin" };
      };
      if (!mounted || !res.ok || !json.ok || !json.profile?.role) return;
      if (json.profile.role === "user") router.replace("/tickets/user");
      if (json.profile.role === "admin") router.replace("/tickets/admin");
    })().catch(() => {});
    return () => {
      mounted = false;
    };
  }, [router]);

  async function onSubmit() {
    setSubmitting(true);
    setError(null);

    if (password !== confirmPassword) {
      setSubmitting(false);
      setError("Passwords do not match.");
      return;
    }

    try {
      const res = await fetch("/api/auth/user/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
      };
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      router.replace(json.redirectTo || "/tickets/user");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DesktopShell>
      <div className="max-w-xl mx-auto surface-card p-5 flex flex-col gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-100">User Sign Up</div>
          <div className="text-xs text-slate-300">
            Create a user account and sign in automatically.
          </div>
        </div>

        <label className="text-xs text-slate-300">
          Full name
          <input
            className="field-input mt-1"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
        </label>

        <label className="text-xs text-slate-300">
          Email
          <input
            className="field-input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </label>

        <label className="text-xs text-slate-300">
          Password
          <input
            className="field-input mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
          />
        </label>

        <label className="text-xs text-slate-300">
          Confirm password
          <input
            className="field-input mt-1"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
          />
        </label>

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={submitting}
          className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "Creating account..." : "Create Account"}
        </button>

        <Link
          href="/login/user"
          className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline text-center"
        >
          Back to User Login
        </Link>
        {error ? <div className="text-xs text-rose-300">{error}</div> : null}
      </div>
    </DesktopShell>
  );
}
