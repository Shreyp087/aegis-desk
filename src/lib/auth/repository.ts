import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { connectMongo } from "@/lib/db/mongoose";
import { AdminModel } from "@/lib/models/Admin";
import { UserModel } from "@/lib/models/User";

import { hashPassword } from "./password";
import type { AuthRole } from "./types";

export type AuthDbProvider = "local" | "mongo";

export type AuthAccountRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: AuthRole;
  createdAt: string;
  lastLogin: string | null;
};

export type AuthAccountRepository = {
  provider: AuthDbProvider;
  findByEmail(role: AuthRole, email: string): Promise<AuthAccountRecord | null>;
  findById(role: AuthRole, id: string): Promise<AuthAccountRecord | null>;
  touchLastLogin(role: AuthRole, id: string): Promise<void>;
  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<AuthAccountRecord>;
};

export class AuthEmailExistsError extends Error {
  constructor(email: string) {
    super(`An account with email ${email} already exists`);
    this.name = "AuthEmailExistsError";
  }
}

type LocalAuthStateV1 = {
  version: 1;
  updatedAt: string;
  accounts: AuthAccountRecord[];
};

type LocalAuthStateUnknown = Partial<LocalAuthStateV1> & { version?: number };

const LOCAL_AUTH_DB_VERSION = 1 as const;
export const LOCAL_AUTH_DB_RELATIVE_PATH = path.join("data", "auth", "accounts.local.json");

const LOCAL_AUTH_SEED = {
  user: {
    name: process.env.LOCAL_AUTH_USER_NAME || "Local Demo User",
    email: (process.env.LOCAL_AUTH_USER_EMAIL || "user@local.aegis").toLowerCase(),
    password: process.env.LOCAL_AUTH_USER_PASSWORD || "UserDemo123!",
    role: "user" as const,
  },
  admin: {
    name: process.env.LOCAL_AUTH_ADMIN_NAME || "Local Demo Admin",
    email: (process.env.LOCAL_AUTH_ADMIN_EMAIL || "admin@local.aegis").toLowerCase(),
    password: process.env.LOCAL_AUTH_ADMIN_PASSWORD || "AdminDemo123!",
    role: "admin" as const,
  },
};

type SeedPreview = {
  user: { email: string; password: string };
  admin: { email: string; password: string };
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getLocalAuthDbPath() {
  return path.join(process.cwd(), LOCAL_AUTH_DB_RELATIVE_PATH);
}

export function getLocalAuthDbPathForDisplay() {
  return LOCAL_AUTH_DB_RELATIVE_PATH;
}

export function getLocalAuthSeedPreview(): SeedPreview {
  return {
    user: { email: LOCAL_AUTH_SEED.user.email, password: LOCAL_AUTH_SEED.user.password },
    admin: { email: LOCAL_AUTH_SEED.admin.email, password: LOCAL_AUTH_SEED.admin.password },
  };
}

export function getAuthDbProvider(): AuthDbProvider {
  const configured = (process.env.AUTH_DB_PROVIDER || "").trim().toLowerCase();
  if (configured === "mongo") return "mongo";
  if (!configured && process.env.MONGODB_URI) return "mongo";
  return "local";
}

function normalizeLocalAuthState(parsed: LocalAuthStateUnknown): LocalAuthStateV1 {
  if (parsed.version === 1 && Array.isArray(parsed.accounts)) {
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      accounts: parsed.accounts.filter(
        (item): item is AuthAccountRecord =>
          Boolean(item) &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.email === "string" &&
          typeof item.passwordHash === "string" &&
          (item.role === "user" || item.role === "admin") &&
          typeof item.createdAt === "string" &&
          (typeof item.lastLogin === "string" || item.lastLogin === null)
      ),
    };
  }
  throw new Error("Invalid local auth DB format");
}

async function ensureLocalAuthDir() {
  await fs.mkdir(path.dirname(getLocalAuthDbPath()), { recursive: true });
}

async function seedLocalAuthState(): Promise<LocalAuthStateV1> {
  const now = new Date().toISOString();
  const [userPasswordHash, adminPasswordHash] = await Promise.all([
    hashPassword(LOCAL_AUTH_SEED.user.password),
    hashPassword(LOCAL_AUTH_SEED.admin.password),
  ]);

  return {
    version: LOCAL_AUTH_DB_VERSION,
    updatedAt: now,
    accounts: [
      {
        id: crypto.randomUUID(),
        name: LOCAL_AUTH_SEED.user.name,
        email: LOCAL_AUTH_SEED.user.email,
        passwordHash: userPasswordHash,
        role: "user",
        createdAt: now,
        lastLogin: null,
      },
      {
        id: crypto.randomUUID(),
        name: LOCAL_AUTH_SEED.admin.name,
        email: LOCAL_AUTH_SEED.admin.email,
        passwordHash: adminPasswordHash,
        role: "admin",
        createdAt: now,
        lastLogin: null,
      },
    ],
  };
}

async function writeLocalAuthState(state: LocalAuthStateV1) {
  await ensureLocalAuthDir();
  const target = getLocalAuthDbPath();
  const temp = `${target}.tmp`;
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, target);
}

async function readLocalAuthState(): Promise<LocalAuthStateV1> {
  const target = getLocalAuthDbPath();
  try {
    const raw = await fs.readFile(target, "utf8");
    return normalizeLocalAuthState(JSON.parse(raw) as LocalAuthStateUnknown);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      const seeded = await seedLocalAuthState();
      await writeLocalAuthState(seeded);
      return seeded;
    }
    throw error;
  }
}

function localRepo(): AuthAccountRepository {
  return {
    provider: "local",
    async findByEmail(role, email) {
      const state = await readLocalAuthState();
      const normalized = normalizeEmail(email);
      return (
        state.accounts.find((account) => account.role === role && normalizeEmail(account.email) === normalized) || null
      );
    },
    async findById(role, id) {
      const state = await readLocalAuthState();
      return state.accounts.find((account) => account.role === role && account.id === id) || null;
    },
    async touchLastLogin(role, id) {
      const state = await readLocalAuthState();
      const account = state.accounts.find((entry) => entry.role === role && entry.id === id);
      if (!account) return;
      account.lastLogin = new Date().toISOString();
      await writeLocalAuthState(state);
    },
    async createUser(input) {
      const state = await readLocalAuthState();
      const normalizedEmail = normalizeEmail(input.email);
      const duplicate = state.accounts.find(
        (account) => normalizeEmail(account.email) === normalizedEmail
      );
      if (duplicate) {
        throw new AuthEmailExistsError(normalizedEmail);
      }

      const createdAt = new Date().toISOString();
      const created: AuthAccountRecord = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash: input.passwordHash,
        role: "user",
        createdAt,
        lastLogin: null,
      };
      state.accounts.push(created);
      await writeLocalAuthState(state);
      return created;
    },
  };
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function shouldAutoSeedMongoAuth(): boolean {
  return parseBooleanEnv(process.env.AUTH_MONGO_AUTO_SEED, process.env.NODE_ENV !== "production");
}

let mongoSeedPromise: Promise<void> | null = null;

async function ensureMongoAuthSeed(): Promise<void> {
  if (!shouldAutoSeedMongoAuth()) return;
  if (mongoSeedPromise) {
    await mongoSeedPromise;
    return;
  }

  mongoSeedPromise = (async () => {
    await connectMongo();
    const [seedUserEmail, seedAdminEmail] = [
      normalizeEmail(LOCAL_AUTH_SEED.user.email),
      normalizeEmail(LOCAL_AUTH_SEED.admin.email),
    ];

    const [existingUser, existingAdmin] = await Promise.all([
      UserModel.findOne({ email: seedUserEmail }).select("_id").lean(),
      AdminModel.findOne({ email: seedAdminEmail }).select("_id").lean(),
    ]);

    const writes: Promise<unknown>[] = [];
    if (!existingUser) {
      const passwordHash = await hashPassword(LOCAL_AUTH_SEED.user.password);
      writes.push(
        UserModel.create({
          name: LOCAL_AUTH_SEED.user.name,
          email: seedUserEmail,
          passwordHash,
          role: "user",
          lastLogin: null,
        })
      );
    }
    if (!existingAdmin) {
      const passwordHash = await hashPassword(LOCAL_AUTH_SEED.admin.password);
      writes.push(
        AdminModel.create({
          name: LOCAL_AUTH_SEED.admin.name,
          email: seedAdminEmail,
          passwordHash,
          role: "admin",
          lastLogin: null,
        })
      );
    }

    if (writes.length > 0) {
      await Promise.all(writes);
    }
  })();

  try {
    await mongoSeedPromise;
  } catch (error) {
    mongoSeedPromise = null;
    throw error;
  }
}

function isDuplicateMongoKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function findMongoAccountByEmail(role: AuthRole, email: string): Promise<AuthAccountRecord | null> {
  await ensureMongoAuthSeed();
  await connectMongo();
  const normalized = normalizeEmail(email);

  if (role === "user") {
    const user = await UserModel.findOne({ email: normalized })
      .select("_id name email passwordHash role createdAt lastLogin")
      .lean<{
        _id: { toString(): string };
        name: string;
        email: string;
        passwordHash: string;
        role: "user";
        createdAt?: Date;
        lastLogin?: Date | null;
      } | null>();
    if (!user) return null;
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      role: "user",
      createdAt: (user.createdAt || new Date(0)).toISOString(),
      lastLogin: user.lastLogin ? new Date(user.lastLogin).toISOString() : null,
    };
  }

  const admin = await AdminModel.findOne({ email: normalized })
    .select("_id name email passwordHash role createdAt lastLogin")
    .lean<{
      _id: { toString(): string };
      name: string;
      email: string;
      passwordHash: string;
      role: "admin";
      createdAt?: Date;
      lastLogin?: Date | null;
    } | null>();
  if (!admin) return null;
  return {
    id: admin._id.toString(),
    name: admin.name,
    email: admin.email,
    passwordHash: admin.passwordHash,
    role: "admin",
    createdAt: (admin.createdAt || new Date(0)).toISOString(),
    lastLogin: admin.lastLogin ? new Date(admin.lastLogin).toISOString() : null,
  };
}

async function findMongoAccountById(role: AuthRole, id: string): Promise<AuthAccountRecord | null> {
  await ensureMongoAuthSeed();
  await connectMongo();

  if (role === "user") {
    const user = await UserModel.findById(id)
      .select("_id name email passwordHash role createdAt lastLogin")
      .lean<{
        _id: { toString(): string };
        name: string;
        email: string;
        passwordHash: string;
        role: "user";
        createdAt?: Date;
        lastLogin?: Date | null;
      } | null>();
    if (!user) return null;
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      role: "user",
      createdAt: (user.createdAt || new Date(0)).toISOString(),
      lastLogin: user.lastLogin ? new Date(user.lastLogin).toISOString() : null,
    };
  }

  const admin = await AdminModel.findById(id)
    .select("_id name email passwordHash role createdAt lastLogin")
    .lean<{
      _id: { toString(): string };
      name: string;
      email: string;
      passwordHash: string;
      role: "admin";
      createdAt?: Date;
      lastLogin?: Date | null;
    } | null>();
  if (!admin) return null;
  return {
    id: admin._id.toString(),
    name: admin.name,
    email: admin.email,
    passwordHash: admin.passwordHash,
    role: "admin",
    createdAt: (admin.createdAt || new Date(0)).toISOString(),
    lastLogin: admin.lastLogin ? new Date(admin.lastLogin).toISOString() : null,
  };
}

async function touchMongoLastLogin(role: AuthRole, id: string): Promise<void> {
  await ensureMongoAuthSeed();
  await connectMongo();
  if (role === "user") {
    await UserModel.updateOne({ _id: id }, { $set: { lastLogin: new Date() } });
    return;
  }
  await AdminModel.updateOne({ _id: id }, { $set: { lastLogin: new Date() } });
}

async function createMongoUser(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<AuthAccountRecord> {
  await ensureMongoAuthSeed();
  await connectMongo();

  const normalizedEmail = normalizeEmail(input.email);
  const existingAdmin = await AdminModel.findOne({ email: normalizedEmail })
    .select("_id")
    .lean();
  if (existingAdmin) {
    throw new AuthEmailExistsError(normalizedEmail);
  }

  try {
    const created = await UserModel.create({
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      role: "user",
      lastLogin: null,
    });

    return {
      id: created._id.toString(),
      name: created.name,
      email: created.email,
      passwordHash: created.passwordHash,
      role: "user",
      createdAt: (created.createdAt || new Date(0)).toISOString(),
      lastLogin: created.lastLogin ? new Date(created.lastLogin).toISOString() : null,
    };
  } catch (error) {
    if (isDuplicateMongoKeyError(error)) {
      throw new AuthEmailExistsError(normalizedEmail);
    }
    throw error;
  }
}

function mongoRepo(): AuthAccountRepository {
  return {
    provider: "mongo",
    findByEmail: findMongoAccountByEmail,
    findById: findMongoAccountById,
    touchLastLogin: touchMongoLastLogin,
    createUser: createMongoUser,
  };
}

export function getAuthAccountRepository(): AuthAccountRepository {
  return getAuthDbProvider() === "mongo" ? mongoRepo() : localRepo();
}
