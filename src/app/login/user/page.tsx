"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DesktopShell from "@/components/DesktopShell";

export default function UserLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; profile?: { role?: "user" | "admin" } };
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
    try {
      const res = await fetch("/api/auth/user/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; redirectTo?: string };
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
          <div className="text-lg font-semibold text-slate-100">User Login</div>
          <div className="text-xs text-slate-300">Access the user ticket dashboard.</div>
        </div>

        <label className="text-xs text-slate-300">
          Email
          <input
            className="field-input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@company.com"
          />
        </label>

        <label className="text-xs text-slate-300">
          Password
          <input
            className="field-input mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>

        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={submitting}
          className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "Signing in..." : "Sign In as User"}
        </button>
        <Link
          href="/login/user/signup"
          className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline text-center"
        >
          Create New User Account
        </Link>
        {error ? <div className="text-xs text-rose-300">{error}</div> : null}
      </div>
    </DesktopShell>
  );
}
