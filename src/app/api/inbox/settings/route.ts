import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/guards";
import { getServerSession } from "@/lib/auth/session";
import {
  buildEnvConsensusPolicy,
  encodeInboxAdminSettingsCookie,
  INBOX_ADMIN_SETTINGS_COOKIE,
  INBOX_ADMIN_SETTINGS_COOKIE_TTL_SECONDS,
  normalizeConsensusMaxModels,
  parseInboxAdminSettingsCookie,
  resolveConsensusPolicy,
} from "@/lib/inbox/settings";

export const runtime = "nodejs";

const SaveInboxSettingsSchema = z.object({
  consensusEnabled: z.boolean(),
  consensusMaxModels: z.number().int().min(1).max(8),
});

export async function GET() {
  const session = await getServerSession();
  const cookieStore = await cookies();

  const envPolicy = buildEnvConsensusPolicy();
  const adminSettings = parseInboxAdminSettingsCookie(
    cookieStore.get(INBOX_ADMIN_SETTINGS_COOKIE)?.value
  );
  const effectivePolicy = resolveConsensusPolicy({ envPolicy, adminSettings });

  return NextResponse.json(
    {
      ok: true,
      canEdit: session?.role === "admin",
      settings: {
        consensusEnabled: effectivePolicy.enabled,
        consensusMaxModels: effectivePolicy.maxModels,
        source: effectivePolicy.source,
      },
    },
    { status: 200 }
  );
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const parsed = SaveInboxSettingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid inbox settings payload",
        detail: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const normalized = {
    consensusEnabled: parsed.data.consensusEnabled,
    consensusMaxModels: normalizeConsensusMaxModels(parsed.data.consensusMaxModels),
    updatedAt: new Date().toISOString(),
    updatedBy: auth.admin.id,
  };

  const cookieStore = await cookies();
  cookieStore.set(
    INBOX_ADMIN_SETTINGS_COOKIE,
    encodeInboxAdminSettingsCookie(normalized),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INBOX_ADMIN_SETTINGS_COOKIE_TTL_SECONDS,
    }
  );

  return NextResponse.json(
    {
      ok: true,
      settings: {
        consensusEnabled: normalized.consensusEnabled,
        consensusMaxModels: normalized.consensusMaxModels,
        source: "admin_override" as const,
      },
      updatedAt: normalized.updatedAt,
    },
    { status: 200 }
  );
}

