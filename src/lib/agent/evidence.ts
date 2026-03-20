import { z } from "zod";

export const ScoredResearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  relevance_score: z.number().min(0).max(1),
  source_quality_score: z.number().min(0).max(1),
  recency_score: z.number().min(0).max(1),
});

export const EvidenceItemSchema = ScoredResearchResultSchema.extend({
  query: z.string(),
});

export const EvidenceConflictSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export const EvidenceConflictSchema = z.object({
  type: z.enum(["domain_mismatch", "mixed_reputation_signals"]),
  query: z.string(),
  summary: z.string(),
  sources: z.array(EvidenceConflictSourceSchema).default([]),
});

export type RawResearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type ScoredResearchResult = z.infer<typeof ScoredResearchResultSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type EvidenceConflict = z.infer<typeof EvidenceConflictSchema>;

type ResearchBatch = {
  query: string;
  results: RawResearchResult[];
};

type ScoredResearchBatch = {
  query: string;
  results: ScoredResearchResult[];
};

type EvidenceSummary = {
  searches: ScoredResearchBatch[];
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  evidence_quality_score: number;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const LOWER_QUALITY_HOSTS = [
  "blogspot.com",
  "crunchbase.com",
  "facebook.com",
  "fandom.com",
  "glassdoor.com",
  "instagram.com",
  "linkedin.com",
  "medium.com",
  "reddit.com",
  "tiktok.com",
  "twitter.com",
  "wikidata.org",
  "wikipedia.org",
  "wordpress.com",
  "x.com",
  "youtube.com",
  "zoominfo.com",
];

const OFFICIALISH_PATTERN = /\b(official|company|about|leadership|team|contact|investor|corporate|press)\b/i;
const POSITIVE_REPUTATION_PATTERN = /\b(official|company|about us|leadership|team|contact|headquarters|products|services|profile)\b/i;
const NEGATIVE_REPUTATION_PATTERN = /\b(scam|fraud|fake|complaint|warning|phishing|spoof|impersonat|breach|lawsuit|malware)\b/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function safeUrl(value: string): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

function hostnameFromUrl(value: string): string {
  return safeUrl(value)?.hostname.toLowerCase().replace(/^www\./, "") || "";
}

function rootDomain(hostname: string): string {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join(".");
}

function scoreRelevance(query: string, result: RawResearchResult): number {
  const queryTokens = [...new Set(tokenize(query))].slice(0, 8);
  if (queryTokens.length === 0) return 0.4;

  const resultText = `${result.title} ${result.snippet} ${result.url}`;
  const resultTokens = new Set(tokenize(resultText));
  const overlap = queryTokens.filter((token) => resultTokens.has(token)).length / queryTokens.length;

  const titleLower = result.title.toLowerCase();
  const firstPair = queryTokens.slice(0, 2).join(" ");
  const phraseBoost = firstPair && titleLower.includes(firstPair) ? 0.15 : 0;
  const domain = hostnameFromUrl(result.url);
  const domainBoost = queryTokens.some((token) => domain.includes(token)) ? 0.1 : 0;

  return roundScore(0.2 + overlap * 0.65 + phraseBoost + domainBoost);
}

function scoreSourceQuality(url: string): number {
  const parsed = safeUrl(url);
  const hostname = parsed?.hostname.toLowerCase().replace(/^www\./, "") || "";
  if (!hostname) return 0.2;

  let score = 0.45;
  if (parsed?.protocol === "https:") score += 0.08;

  if (/\.(gov|mil)$/i.test(hostname)) {
    score += 0.3;
  } else if (/\.edu$/i.test(hostname)) {
    score += 0.24;
  } else if (/\.org$/i.test(hostname)) {
    score += 0.14;
  } else if (/\.(com|net|io|co|ai)$/i.test(hostname)) {
    score += 0.1;
  } else {
    score += 0.04;
  }

  if (hostname.split(".").length <= 3) score += 0.04;

  if (LOWER_QUALITY_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    score -= 0.18;
  }

  const path = parsed?.pathname.toLowerCase() || "";
  if (/(\/blog\/|\/wiki\/|\/forums?\/|\/community\/|\/thread\/|\/posts?\/)/i.test(path)) {
    score -= 0.08;
  }

  return roundScore(score);
}

function parseDateCandidate(value: string): Date | null {
  const text = value.replace(/\s+/g, " ");
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const namedMonthMatch = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*(20\d{2})\b/i
  );
  if (namedMonthMatch) {
    const parsed = new Date(namedMonthMatch[0]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (slashMatch) {
    const parsed = new Date(`${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const yearMatch = text.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const parsed = new Date(`${yearMatch[1]}-01-01T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function scoreRecency(result: RawResearchResult): number {
  const parsed = parseDateCandidate(`${result.title} ${result.snippet} ${result.url}`);
  if (!parsed) return 0.5;

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays <= 30) return 1;
  if (diffDays <= 90) return 0.85;
  if (diffDays <= 180) return 0.7;
  if (diffDays <= 365) return 0.55;
  if (diffDays <= 730) return 0.4;
  return 0.25;
}

function scoreResultQuality(result: ScoredResearchResult): number {
  return roundScore(
    result.relevance_score * 0.5 +
      result.source_quality_score * 0.3 +
      result.recency_score * 0.2
  );
}

export function scoreResultsForQuery(query: string, results: RawResearchResult[]): ScoredResearchResult[] {
  return results.map((result) => ({
    ...result,
    relevance_score: scoreRelevance(query, result),
    source_quality_score: scoreSourceQuality(result.url),
    recency_score: scoreRecency(result),
  }));
}

function detectQueryConflicts(query: string, results: ScoredResearchResult[]): EvidenceConflict[] {
  const conflicts: EvidenceConflict[] = [];
  const highSignalResults = results.filter(
    (result) => result.relevance_score >= 0.45 && result.source_quality_score >= 0.5
  );

  const officialishResults = highSignalResults.filter((result) =>
    OFFICIALISH_PATTERN.test(`${result.title} ${result.snippet} ${result.url}`)
  );
  const officialDomains = [...new Set(officialishResults.map((result) => rootDomain(hostnameFromUrl(result.url))).filter(Boolean))];
  if (officialDomains.length >= 2) {
    conflicts.push({
      type: "domain_mismatch",
      query,
      summary: `Potential source disagreement: official-looking results point to multiple domains (${officialDomains.join(", ")}).`,
      sources: officialishResults.slice(0, 4).map((result) => ({
        title: result.title,
        url: result.url,
      })),
    });
  }

  const positiveResults = highSignalResults.filter((result) =>
    POSITIVE_REPUTATION_PATTERN.test(`${result.title} ${result.snippet}`)
  );
  const negativeResults = highSignalResults.filter((result) =>
    NEGATIVE_REPUTATION_PATTERN.test(`${result.title} ${result.snippet}`)
  );

  if (positiveResults.length > 0 && negativeResults.length > 0) {
    conflicts.push({
      type: "mixed_reputation_signals",
      query,
      summary: "Sources disagree on whether the entity appears official or risky.",
      sources: [...positiveResults.slice(0, 2), ...negativeResults.slice(0, 2)].map((result) => ({
        title: result.title,
        url: result.url,
      })),
    });
  }

  return conflicts;
}

export function summarizeResearchEvidence(searches: ResearchBatch[]): EvidenceSummary {
  const scoredSearches = searches.map(({ query, results }) => ({
    query,
    results: scoreResultsForQuery(query, results),
  }));

  const evidence: EvidenceItem[] = scoredSearches.flatMap(({ query, results }) =>
    results.map((result) => ({
      query,
      ...result,
    }))
  );

  const conflicts = scoredSearches.flatMap(({ query, results }) => detectQueryConflicts(query, results));
  const evidenceScores = evidence.map(scoreResultQuality);
  const baseQuality =
    evidenceScores.length > 0
      ? evidenceScores.reduce((sum, score) => sum + score, 0) / evidenceScores.length
      : 0;
  const conflictPenalty = Math.min(0.15, conflicts.length * 0.05);

  return {
    searches: scoredSearches,
    evidence,
    conflicts,
    evidence_quality_score: roundScore(baseQuality - conflictPenalty),
  };
}
