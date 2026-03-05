"use client";

import { LedgerEntry } from "./types";

const KEY = "queueguard_ledger_v1";

function safeJsonParse<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readLedger(): LedgerEntry[] {
  if (typeof window === "undefined") return [];
  return safeJsonParse<LedgerEntry[]>(localStorage.getItem(KEY), []);
}

export function clearLedger() {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify([]));
}

export async function appendLedger(entry: LedgerEntry): Promise<LedgerEntry> {
  if (typeof window === "undefined") return entry;

  const ledger = readLedger();
  const prev = ledger[0];
  const prevHash = prev?.entryHash ?? "";

  const entryWithoutHash = { ...entry };
  delete (entryWithoutHash as any).prevHash;
  delete (entryWithoutHash as any).entryHash;

  const payload = prevHash + JSON.stringify(entryWithoutHash);
  const entryHash = await sha256Hex(payload);

  const finalized: LedgerEntry = {
    ...entryWithoutHash,
    prevHash: prevHash || undefined,
    entryHash,
  };

  const next = [finalized, ...ledger].slice(0, 250);
  localStorage.setItem(KEY, JSON.stringify(next));

  return finalized;
}
