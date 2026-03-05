import { InboxEntityTypeEnum, type InboxEntityType } from "./schemas";

export type EntityCandidate = {
  name: string;
  entityType: InboxEntityType;
  source: "text" | "query";
  confidence: number;
};

function normalizeEntityName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function keyOf(name: string): string {
  return normalizeEntityName(name).toLowerCase();
}

function inferEntityType(name: string): InboxEntityType {
  const lower = name.toLowerCase();
  if (/\b(inc|corp|corporation|llc|ltd|limited|gmbh|plc)\b/.test(lower)) {
    return "company";
  }
  if (/\b(university|department|agency|ministry|foundation|association|bank|committee)\b/.test(lower)) {
    return "organization";
  }
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(name)) {
    return "person";
  }
  return "unknown";
}

function pushCandidate(
  bucket: Map<string, EntityCandidate>,
  candidate: EntityCandidate
): void {
  const normalized = normalizeEntityName(candidate.name);
  if (!normalized || normalized.length < 3) return;
  if (InboxEntityTypeEnum.safeParse(candidate.entityType).success === false) return;

  const key = keyOf(normalized);
  const existing = bucket.get(key);
  if (!existing) {
    bucket.set(key, {
      ...candidate,
      name: normalized,
    });
    return;
  }

  const boostedConfidence = Math.min(1, existing.confidence + candidate.confidence * 0.25);
  const strongerType =
    existing.entityType === "unknown" && candidate.entityType !== "unknown"
      ? candidate.entityType
      : existing.entityType;
  bucket.set(key, {
    ...existing,
    entityType: strongerType,
    confidence: boostedConfidence,
    source: existing.source,
  });
}

export function extractEntityCandidatesFromContext(args: {
  emailText: string;
  docText: string;
  searchQueries?: string[];
  maxEntities?: number;
}): EntityCandidate[] {
  const text = `${args.emailText}\n${args.docText}`;
  const out = new Map<string, EntityCandidate>();

  const companyRegex =
    /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4}\s(?:LLC|Inc|Corp|Corporation|Ltd|Limited|PLC|GmbH))\b/g;
  const orgRegex =
    /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,5}\s(?:University|Department|Agency|Ministry|Foundation|Association|Bank|Committee))\b/g;
  const personRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;

  let m: RegExpExecArray | null;
  while ((m = companyRegex.exec(text)) !== null) {
    pushCandidate(out, {
      name: m[1],
      entityType: "company",
      source: "text",
      confidence: 0.9,
    });
  }
  while ((m = orgRegex.exec(text)) !== null) {
    pushCandidate(out, {
      name: m[1],
      entityType: "organization",
      source: "text",
      confidence: 0.82,
    });
  }
  while ((m = personRegex.exec(text)) !== null) {
    const raw = m[1];
    if (raw.length > 60) continue;
    if (/\b(Subject|From|To|Date|Body)\b/.test(raw)) continue;
    pushCandidate(out, {
      name: raw,
      entityType: "person",
      source: "text",
      confidence: 0.65,
    });
  }

  for (const query of args.searchQueries || []) {
    const lead = normalizeEntityName(query.split(",")[0] || query).split(/\s{2,}/)[0];
    if (!lead) continue;
    const inferredType = inferEntityType(lead);
    pushCandidate(out, {
      name: lead,
      entityType: inferredType,
      source: "query",
      confidence: inferredType === "unknown" ? 0.45 : 0.68,
    });
  }

  const maxEntities = Math.max(2, Math.min(6, args.maxEntities ?? 6));
  return Array.from(out.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxEntities);
}

