"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type User = {
  id: string;
  email: string;
  role: "admin" | "user";
  name: string;
};

export type SessionMemory = {
  signedInAt: string | null;
  lastActiveAt: string | null;
  currentPath: string | null;
  recentPaths: string[];
};

type AuthContextType = {
  user: User | null;
  role: "admin" | "user" | null;
  loading: boolean;
  sessionMemory: SessionMemory;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);
const SESSION_MEMORY_PREFIX = "aegis.session-memory";
const EMPTY_SESSION_MEMORY: SessionMemory = {
  signedInAt: null,
  lastActiveAt: null,
  currentPath: null,
  recentPaths: [],
};

function getSessionMemoryKey(userId: string) {
  return `${SESSION_MEMORY_PREFIX}.${userId}`;
}

function normalizeSessionMemory(value: unknown): SessionMemory {
  if (!value || typeof value !== "object") return EMPTY_SESSION_MEMORY;

  const candidate = value as Partial<SessionMemory>;

  return {
    signedInAt: typeof candidate.signedInAt === "string" ? candidate.signedInAt : null,
    lastActiveAt: typeof candidate.lastActiveAt === "string" ? candidate.lastActiveAt : null,
    currentPath: typeof candidate.currentPath === "string" ? candidate.currentPath : null,
    recentPaths: Array.isArray(candidate.recentPaths)
      ? candidate.recentPaths.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
      : [],
  };
}

function readSessionMemory(userId: string): SessionMemory {
  if (typeof window === "undefined") return EMPTY_SESSION_MEMORY;

  try {
    const raw = window.sessionStorage.getItem(getSessionMemoryKey(userId));
    if (!raw) return EMPTY_SESSION_MEMORY;
    return normalizeSessionMemory(JSON.parse(raw));
  } catch {
    return EMPTY_SESSION_MEMORY;
  }
}

function writeSessionMemory(userId: string, memory: SessionMemory) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(getSessionMemoryKey(userId), JSON.stringify(memory));
  } catch {
    // Ignore session storage failures.
  }
}

function clearSessionMemory(userId: string) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(getSessionMemoryKey(userId));
  } catch {
    // Ignore session storage failures.
  }
}

export function AuthProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: User | null;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(false);
  const [sessionMemory, setSessionMemory] = useState<SessionMemory>(EMPTY_SESSION_MEMORY);

  useEffect(() => {
    if (!user?.id) {
      setSessionMemory(EMPTY_SESSION_MEMORY);
      return;
    }

    const now = new Date().toISOString();
    const stored = readSessionMemory(user.id);
    const currentPath = pathname || stored.currentPath || null;
    const recentPaths = currentPath
      ? [currentPath, ...stored.recentPaths.filter((entry) => entry !== currentPath)].slice(0, 6)
      : stored.recentPaths;

    const nextMemory: SessionMemory = {
      signedInAt: stored.signedInAt || now,
      lastActiveAt: now,
      currentPath,
      recentPaths,
    };

    setSessionMemory(nextMemory);
    writeSessionMemory(user.id, nextMemory);
  }, [pathname, user?.id]);

  const signOut = useCallback(async () => {
    const currentUserId = user?.id;

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      if (currentUserId) {
        clearSessionMemory(currentUserId);
      }
      setUser(null);
      setSessionMemory(EMPTY_SESSION_MEMORY);
      setLoading(false);
    }
  }, [user?.id]);

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      loading,
      sessionMemory,
      signOut,
    }),
    [loading, sessionMemory, signOut, user]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
