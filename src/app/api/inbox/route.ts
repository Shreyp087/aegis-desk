import { createHash } from "crypto";

import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { fetchLatestGmailRawEmails, getValidGmailToken } from "@/lib/inbox/gmail";
import {
  OFFLINE_MODE_TEMPLATE_THRESHOLDS,
  OFFLINE_MODE_TEMPLATE_WEIGHTS,
  getOfflineRuntimeConfig,
  isOfflineEnforced,
} from "@/lib/offline";

type Category =
  | "scam_bec"
  | "scam_invoice_fraud"
  | "scam_credential_phishing"
  | "scam_malware_attachment"
  | "scam_impersonation"
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general";

type Priority = "high" | "medium" | "low";
type TrustedDecisionAction = "allow" | "escalate" | "quarantine" | "block";

type TrustNode = {
  seen: number;
  high: number;
  medium: number;
  lastSeen: number;
};

type TrustGraph = {
  senders: Record<string, TrustNode>;
  domains: Record<string, TrustNode>;
};

type CategoryScore = {
  category: Category;
  score: number;
  reason: string;
};

type ReputationProfile = {
  score: number;
  findings: string[];
  domains: string[];
};

type ThreadProfile = {
  key: string;
  depth: number;
  riskDensity: number;
};

type ParsedEmail = {
  id: string;
  raw: string;
  from: string;
  subject: string;
  senderEmail: string;
  senderDomain: string;
  body: string;
  threadKey: string;
  extracted: {
    deadlines: string[];
    moneyMentions: string[];
    urls: string[];
    attachments: string[];
    attachmentRiskScore: number;
    urlDomains: string[];
  };
};

type ScoredEmail = ParsedEmail & {
  priorityScore: number;
  priority: Priority;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  trustScore: number;
  reputation: ReputationProfile;
  thread: ThreadProfile;
  baseUncertaintyPercent: number;
  evidenceStrength: number;
};

const CategoryEnum = z.enum([
  "scam_bec",
  "scam_invoice_fraud",
  "scam_credential_phishing",
  "scam_malware_attachment",
  "scam_impersonation",
  "security_phishing",
  "finance_payment",
  "legal_contract",
  "deadline_scheduling",
  "executive_escalation",
  "sales_marketing",
  "ops_support",
  "newsletter",
  "general",
]);

const PriorityEnum = z.enum(["high", "medium", "low"]);
const TrustedDecisionActionEnum = z.enum(["allow", "escalate", "quarantine", "block"]);

const InboxRequestSchema = z.object({
  mode: z.enum(["manual", "gmail"]).default("manual"),
  emails: z.array(z.string()).default([]),
  gmail: z
    .object({
      maxResults: z.number().int().min(1).max(50).optional(),
      query: z.string().min(1).max(200).optional(),
    })
    .optional(),
  userContext: z
    .object({
      orgDomains: z.array(z.string()).optional(),
    })
    .optional(),
});

const CategoryScoreSchema = z.object({
  category: CategoryEnum,
  score: z.number().min(0).max(100),
  reason: z.string(),
});

const AlertSchema = z.object({
  id: z.string(),
  from: z.string(),
  senderEmail: z.string(),
  senderDomain: z.string(),
  subject: z.string(),
  priorityScore: z.number().min(0).max(100),
  priority: PriorityEnum,
  primaryCategory: CategoryEnum,
  categoryScores: z.array(CategoryScoreSchema),
  riskTags: z.array(z.string()),
  signals: z.array(z.string()),
  suggestedAction: z.string(),
  draftReply: z.string(),
  consensusScore: z.number().min(0).max(100),
  consensusNote: z.string(),
  trustedDecision: z.object({
    action: TrustedDecisionActionEnum,
    confidencePct: z.number().min(0).max(100),
    riskScore: z.number().min(0).max(100),
    note: z.string(),
  }),
  trustScore: z.number().min(0).max(100),
  reputationScore: z.number().min(0).max(100),
  reputationFindings: z.array(z.string()),
  thread: z.object({
    key: z.string(),
    depth: z.number().min(1),
    riskDensity: z.number().min(0).max(1),
  }),
  uncertaintyPercent: z.number().min(0).max(100),
  baseUncertaintyPercent: z.number().min(0).max(100),
  rawEmail: z.string(),
  extracted: z.object({
    deadlines: z.array(z.string()),
    moneyMentions: z.array(z.string()),
    urls: z.array(z.string()),
    attachments: z.array(z.string()),
    attachmentRiskScore: z.number().min(0).max(100),
  }),
});

type Alert = z.infer<typeof AlertSchema>;

const InboxResponseSchema = z.object({
  ok: z.literal(true),
  alerts: z.array(AlertSchema),
  meta: z.object({
    mode: z.string(),
    processingMode: z.enum(["offline_enforced", "hybrid_remote_llm"]),
    offlineState: z.string(),
    scanned: z.number(),
    highCount: z.number(),
    mediumCount: z.number(),
    lowCount: z.number(),
  }),
});

const TRUST_COOKIE = "aegis_inbox_trust_graph";
const TRUST_COOKIE_TTL_SECONDS = 120 * 24 * 60 * 60;

const HIGH_RISK_ATTACHMENT_EXT = new Set(["exe", "js", "vbs", "bat", "cmd", "scr", "hta", "iso", "dll"]);
const MEDIUM_RISK_ATTACHMENT_EXT = new Set(["zip", "rar", "7z", "docm", "xlsm", "pptm", "html", "htm"]);
const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".icu", ".ru", ".work", ".live"];
const FREE_MAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "icloud.com"]);

const PATTERNS = {
  security: [
    /\bpassword\b/i,
    /\bcredentials?\b/i,
    /\blogin\b/i,
    /\breset\b/i,
    /\b2fa\b/i,
    /\bmfa\b/i,
    /\bverify your account\b/i,
    /\bsecurity alert\b/i,
    /\bsuspicious sign[- ]in\b/i,
  ],
  payment: [
    /\bwire transfer\b/i,
    /\bbank details?\b/i,
    /\binvoice\b/i,
    /\bpayment\b/i,
    /\bach\b/i,
    /\bbeneficiary\b/i,
    /\baccount number\b/i,
    /\brefund\b/i,
  ],
  legal: [
    /\bagreement\b/i,
    /\bcontract\b/i,
    /\bnda\b/i,
    /\bindemnif/i,
    /\bliability\b/i,
    /\bterms\b/i,
    /\bgoverning law\b/i,
    /\bsignature\b/i,
  ],
  deadline: [
    /\burgent\b/i,
    /\basap\b/i,
    /\bimmediately\b/i,
    /\baction required\b/i,
    /\bwithin\s+\d+\s*(hours|days)\b/i,
    /\btoday\b/i,
    /\btomorrow\b/i,
    /\beod\b/i,
    /\bend of day\b/i,
    /\bdue\b/i,
  ],
  scheduling: [
    /\bmeeting\b/i,
    /\bcall\b/i,
    /\bcalendar\b/i,
    /\bschedule\b/i,
    /\breschedule\b/i,
    /\binvite\b/i,
    /\bavailability\b/i,
  ],
  executive: [/\bceo\b/i, /\bcfo\b/i, /\bcto\b/i, /\bfounder\b/i, /\bboard\b/i, /\bexecutive\b/i],
  sales: [/\bproposal\b/i, /\bquote\b/i, /\bdemo\b/i, /\bpricing\b/i, /\bdiscount\b/i, /\btrial\b/i],
  support: [/\bticket\b/i, /\bincident\b/i, /\boutage\b/i, /\bissue\b/i, /\bbug\b/i, /\bsupport\b/i],
  newsletter: [/\bunsubscribe\b/i, /\bnewsletter\b/i, /\bweekly digest\b/i, /\bmarketing\b/i, /\bpromotion\b/i],
  impersonation: [
    /\bceo request\b/i,
    /\bcfo request\b/i,
    /\bexecutive request\b/i,
    /\bon behalf of\b/i,
    /\bkeep this confidential\b/i,
    /\bdo not call\b/i,
    /\bgift card\b/i,
    /\bvendor changed bank details\b/i,
    /\bnew bank account\b/i,
  ],
  malware: [/\benabled macro\b/i, /\bmacro-enabled\b/i, /\bdownload attachment\b/i, /\bopen attachment\b/i],
};

const CALIBRATION_PROFILES: Record<
  Category,
  { slope: number; offset: number; reliabilityWeight: number }
> = {
  scam_bec: { slope: 1.12, offset: 5, reliabilityWeight: 0.76 },
  scam_invoice_fraud: { slope: 1.1, offset: 4, reliabilityWeight: 0.74 },
  scam_credential_phishing: { slope: 1.12, offset: 5, reliabilityWeight: 0.76 },
  scam_malware_attachment: { slope: 1.09, offset: 4, reliabilityWeight: 0.72 },
  scam_impersonation: { slope: 1.08, offset: 4, reliabilityWeight: 0.71 },
  security_phishing: { slope: 1.08, offset: 3, reliabilityWeight: 0.7 },
  finance_payment: { slope: 1.05, offset: 2, reliabilityWeight: 0.68 },
  legal_contract: { slope: 1.02, offset: 1, reliabilityWeight: 0.62 },
  deadline_scheduling: { slope: 0.98, offset: -2, reliabilityWeight: 0.55 },
  executive_escalation: { slope: 1.0, offset: 0, reliabilityWeight: 0.58 },
  sales_marketing: { slope: 0.95, offset: -4, reliabilityWeight: 0.48 },
  ops_support: { slope: 0.97, offset: -2, reliabilityWeight: 0.53 },
  newsletter: { slope: 0.92, offset: -6, reliabilityWeight: 0.4 },
  general: { slope: 0.96, offset: -3, reliabilityWeight: 0.45 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countHits(text: string, regexes: RegExp[]): number {
  return regexes.reduce((sum, re) => sum + (re.test(text) ? 1 : 0), 0);
}

function extractHeader(raw: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "im");
  const m = raw.match(re);
  return (m?.[1] || "").trim();
}

function extractSubject(raw: string): string {
  return extractHeader(raw, "Subject") || "(No subject)";
}

function extractFrom(raw: string): string {
  return extractHeader(raw, "From") || "(Unknown sender)";
}

function extractBody(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const bodyStart = lines.findIndex((line) => /^body:\s*$/i.test(line) || /^body:/i.test(line));
  if (bodyStart >= 0) {
    return lines.slice(bodyStart + 1).join("\n").trim();
  }

  return lines
    .filter((line) => !/^(from:|to:|subject:|date:|thread-id:|attachments:)\s*/i.test(line))
    .join("\n")
    .trim();
}

function senderEmailFromFromHeader(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const email = (m?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.replace(/[^\w@.+-]/g, "").toLowerCase();
}

function domainFromFromHeader(from: string): string {
  const emailMatch = from.match(/<([^>]+)>/);
  const email = (emailMatch?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).replace(/[^\w.-]/g, "").toLowerCase();
}

function extractThreadId(raw: string): string {
  return extractHeader(raw, "Thread-Id");
}

function normalizeSubjectForThread(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveThreadKey(raw: string, subject: string, senderDomain: string): string {
  const threadId = extractThreadId(raw);
  if (threadId) return `gmail:${threadId}`;
  return `subject:${senderDomain || "unknown"}:${normalizeSubjectForThread(subject) || "none"}`;
}

function extractDeadlines(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bby\s+(end of day|eod|end of week)\b/gi,
    /\bwithin\s+\d+\s+(hours|days|weeks)\b/gi,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\btomorrow\b/gi,
    /\btoday\b/gi,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 8);
}

function extractMoneyMentions(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [/\$\s?\d[\d,]*(?:\.\d{2})?/g, /\bUSD\s?\d[\d,]*(?:\.\d{2})?\b/gi];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 8);
}

function extractUrls(raw: string): string[] {
  const out = new Set<string>();
  const re = /\bhttps?:\/\/[^\s)]+/gi;
  const m = raw.match(re);
  if (m) m.forEach((x) => out.add(x.trim()));
  return Array.from(out).slice(0, 10);
}

function extractDomainsFromUrls(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host) out.add(host);
    } catch {
      // ignore invalid URL
    }
  }
  return Array.from(out).slice(0, 10);
}

function extractAttachments(raw: string): { attachments: string[]; attachmentRiskScore: number } {
  const out = new Set<string>();
  const headerList = extractHeader(raw, "Attachments");
  if (headerList) {
    headerList
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => out.add(x));
  }

  const filePattern =
    /\b[a-zA-Z0-9._ -]+\.(pdf|doc|docx|docm|xls|xlsx|xlsm|csv|ppt|pptx|pptm|zip|rar|7z|exe|js|vbs|bat|cmd|scr|html|htm)\b/g;
  const matches = raw.match(filePattern);
  if (matches) {
    matches.forEach((m) => out.add(m.trim()));
  }

  const attachments = Array.from(out).slice(0, 12);
  let risk = 0;
  for (const name of attachments) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (HIGH_RISK_ATTACHMENT_EXT.has(ext)) risk += 26;
    else if (MEDIUM_RISK_ATTACHMENT_EXT.has(ext)) risk += 12;
  }
  if (attachments.length >= 4) risk += 6;

  return { attachments, attachmentRiskScore: clamp(risk, 0, 100) };
}

function createHashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function defaultTrustGraph(): TrustGraph {
  return { senders: {}, domains: {} };
}

function parseTrustNode(value: unknown): TrustNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Partial<TrustNode>;
  if (
    typeof node.seen !== "number" ||
    typeof node.high !== "number" ||
    typeof node.medium !== "number" ||
    typeof node.lastSeen !== "number"
  ) {
    return null;
  }
  return {
    seen: clamp(Math.round(node.seen), 0, 10000),
    high: clamp(Math.round(node.high), 0, 10000),
    medium: clamp(Math.round(node.medium), 0, 10000),
    lastSeen: node.lastSeen,
  };
}

function readTrustGraphCookie(cookieValue?: string): TrustGraph {
  if (!cookieValue) return defaultTrustGraph();
  try {
    const raw = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as {
      senders?: Record<string, unknown>;
      domains?: Record<string, unknown>;
    };

    const senders: Record<string, TrustNode> = {};
    const domains: Record<string, TrustNode> = {};

    for (const [k, v] of Object.entries(raw.senders || {})) {
      const node = parseTrustNode(v);
      if (node) senders[k] = node;
    }
    for (const [k, v] of Object.entries(raw.domains || {})) {
      const node = parseTrustNode(v);
      if (node) domains[k] = node;
    }

    return { senders, domains };
  } catch {
    return defaultTrustGraph();
  }
}

function pruneNodes(nodes: Record<string, TrustNode>, maxEntries: number): Record<string, TrustNode> {
  const entries = Object.entries(nodes).sort((a, b) => b[1].lastSeen - a[1].lastSeen).slice(0, maxEntries);
  return Object.fromEntries(entries);
}

function writeTrustGraphCookie(store: Awaited<ReturnType<typeof cookies>>, graph: TrustGraph): void {
  const payload = {
    senders: pruneNodes(graph.senders, 80),
    domains: pruneNodes(graph.domains, 80),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  store.set(TRUST_COOKIE, encoded, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUST_COOKIE_TTL_SECONDS,
  });
}

function trustScoreFromNode(node: TrustNode | null): number {
  if (!node) return 45;
  const recentDays = (Date.now() - node.lastSeen) / (1000 * 60 * 60 * 24);
  const recencyBoost = recentDays <= 14 ? 6 : recentDays <= 45 ? 2 : 0;
  const score =
    45 +
    Math.min(20, node.seen * 3.2) -
    Math.min(28, node.high * 7) -
    Math.min(10, node.medium * 2) +
    recencyBoost;
  return clamp(Math.round(score), 5, 95);
}

function getTrustScore(graph: TrustGraph, senderEmail: string, senderDomain: string): number {
  const senderNode = senderEmail ? graph.senders[createHashKey(`sender:${senderEmail}`)] : null;
  const domainNode = senderDomain ? graph.domains[createHashKey(`domain:${senderDomain}`)] : null;

  const senderScore = trustScoreFromNode(senderNode || null);
  const domainScore = trustScoreFromNode(domainNode || null);
  return clamp(Math.round(senderScore * 0.55 + domainScore * 0.45), 5, 95);
}

function updateTrustNode(node: TrustNode | undefined, priority: Priority): TrustNode {
  const base: TrustNode = node || { seen: 0, high: 0, medium: 0, lastSeen: Date.now() };
  return {
    seen: base.seen + 1,
    high: base.high + (priority === "high" ? 1 : 0),
    medium: base.medium + (priority === "medium" ? 1 : 0),
    lastSeen: Date.now(),
  };
}

function updateTrustGraph(graph: TrustGraph, senderEmail: string, senderDomain: string, priority: Priority): void {
  if (senderEmail) {
    const senderKey = createHashKey(`sender:${senderEmail}`);
    graph.senders[senderKey] = updateTrustNode(graph.senders[senderKey], priority);
  }
  if (senderDomain) {
    const domainKey = createHashKey(`domain:${senderDomain}`);
    graph.domains[domainKey] = updateTrustNode(graph.domains[domainKey], priority);
  }
}

function buildReputationProfile(args: {
  senderDomain: string;
  urlDomains: string[];
  orgDomains: string[];
  trustScore: number;
}): ReputationProfile {
  const domains = Array.from(new Set([args.senderDomain, ...args.urlDomains].filter(Boolean))).slice(0, 10);
  let risk = 0;
  const findings: string[] = [];

  if (!args.senderDomain) {
    risk += 20;
    findings.push("Sender domain could not be parsed.");
  }

  for (const domain of domains) {
    const lower = domain.toLowerCase();
    const tldHit = SUSPICIOUS_TLDS.some((tld) => lower.endsWith(tld));
    if (tldHit) {
      risk += 20;
      findings.push(`Suspicious top-level domain detected: ${lower}`);
    }
    if (lower.includes("xn--")) {
      risk += 18;
      findings.push(`Punycode/homograph pattern detected: ${lower}`);
    }
    const hyphenCount = (lower.match(/-/g) || []).length;
    if (hyphenCount >= 3) {
      risk += 8;
      findings.push(`Domain has many hyphens: ${lower}`);
    }
    const alnum = lower.replace(/[^a-z0-9]/g, "");
    const digitCount = (alnum.match(/[0-9]/g) || []).length;
    if (alnum.length > 0 && digitCount / alnum.length >= 0.3) {
      risk += 8;
      findings.push(`Domain contains unusually high numeric ratio: ${lower}`);
    }
    if (/(secure|verify|login|update|auth|billing|account|support)/i.test(lower)) {
      risk += 6;
      findings.push(`Domain uses impersonation-prone keywords: ${lower}`);
    }
  }

  const senderDomain = args.senderDomain.toLowerCase();
  const mismatchUrls = args.urlDomains.filter(
    (domain) => !domain.endsWith(senderDomain) && !senderDomain.endsWith(domain)
  );
  if (senderDomain && mismatchUrls.length > 0) {
    risk += 12;
    findings.push("Sender domain and linked domains are inconsistent.");
  }

  if (senderDomain && FREE_MAIL_DOMAINS.has(senderDomain)) {
    risk += 14;
    findings.push("Sender uses a free-mail domain for potentially business-critical communication.");
  }

  if (args.orgDomains.includes(senderDomain)) {
    risk -= 18;
    findings.push("Sender domain matches organization domain allowlist.");
  }

  if (args.trustScore >= 78) {
    risk -= 10;
    findings.push("Sender/domain has strong historical trust score.");
  } else if (args.trustScore <= 30) {
    risk += 10;
    findings.push("Sender/domain has low historical trust score.");
  }

  const score = clamp(100 - risk, 5, 98);
  return {
    score,
    findings: Array.from(new Set(findings)).slice(0, 8),
    domains,
  };
}

function buildThreadProfiles(parsed: ParsedEmail[]): Record<string, ThreadProfile> {
  const stats: Record<
    string,
    {
      count: number;
      riskHits: number;
      urgencyHits: number;
    }
  > = {};

  for (const email of parsed) {
    const text = `${email.subject}\n${email.body}`;
    const riskHits = countHits(text, [...PATTERNS.security, ...PATTERNS.payment, ...PATTERNS.legal]);
    const urgencyHits = countHits(text, PATTERNS.deadline);
    const cur = stats[email.threadKey] || { count: 0, riskHits: 0, urgencyHits: 0 };
    cur.count += 1;
    cur.riskHits += riskHits;
    cur.urgencyHits += urgencyHits;
    stats[email.threadKey] = cur;
  }

  const out: Record<string, ThreadProfile> = {};
  for (const [key, value] of Object.entries(stats)) {
    const density = value.count > 0 ? clamp((value.riskHits + value.urgencyHits * 0.75) / (value.count * 6), 0, 1) : 0;
    out[key] = {
      key,
      depth: Math.max(1, value.count),
      riskDensity: Number(density.toFixed(2)),
    };
  }
  return out;
}

function buildCategoryScores(args: {
  text: string;
  externalSender: boolean;
  suspiciousDomain: boolean;
  extracted: ParsedEmail["extracted"];
  trustScore: number;
  reputationScore: number;
  thread: ThreadProfile;
}): CategoryScore[] {
  const securityHits = countHits(args.text, PATTERNS.security);
  const paymentHits = countHits(args.text, PATTERNS.payment);
  const legalHits = countHits(args.text, PATTERNS.legal);
  const deadlineHits = countHits(args.text, PATTERNS.deadline);
  const scheduleHits = countHits(args.text, PATTERNS.scheduling);
  const execHits = countHits(args.text, PATTERNS.executive);
  const salesHits = countHits(args.text, PATTERNS.sales);
  const supportHits = countHits(args.text, PATTERNS.support);
  const newsletterHits = countHits(args.text, PATTERNS.newsletter);
  const impersonationHits = countHits(args.text, PATTERNS.impersonation);
  const malwareHits = countHits(args.text, PATTERNS.malware);

  const trustRisk = args.trustScore <= 35 ? 1 : 0;
  const reputationRisk = args.reputationScore <= 45 ? 1 : 0;

  const scamBecScore =
    execHits * 16 +
    deadlineHits * 8 +
    impersonationHits * 18 +
    paymentHits * 7 +
    (args.externalSender ? 12 : 0) +
    (args.suspiciousDomain ? 10 : 0) +
    trustRisk * 10 +
    reputationRisk * 10 +
    args.thread.riskDensity * 12;

  const scamInvoiceScore =
    paymentHits * 18 +
    deadlineHits * 7 +
    (args.extracted.moneyMentions.length > 0 ? 10 : 0) +
    impersonationHits * 6 +
    (args.externalSender ? 10 : 0) +
    (args.suspiciousDomain ? 8 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    args.thread.riskDensity * 10;

  const scamCredentialScore =
    securityHits * 18 +
    (args.extracted.urls.length > 0 ? 12 : 0) +
    (args.extracted.attachmentRiskScore > 30 ? 6 : 0) +
    (args.externalSender ? 10 : 0) +
    (args.suspiciousDomain ? 14 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    impersonationHits * 4 +
    args.thread.riskDensity * 10;

  const scamMalwareScore =
    malwareHits * 18 +
    args.extracted.attachmentRiskScore * 0.9 +
    (args.extracted.attachments.length > 0 ? 8 : 0) +
    (args.externalSender ? 8 : 0) +
    (args.suspiciousDomain ? 6 : 0) +
    trustRisk * 6 +
    args.thread.riskDensity * 8;

  const scamImpersonationScore =
    impersonationHits * 20 +
    execHits * 10 +
    (args.externalSender ? 12 : 0) +
    (args.suspiciousDomain ? 12 : 0) +
    trustRisk * 8 +
    reputationRisk * 8 +
    deadlineHits * 6;

  const securityScore =
    securityHits * 17 +
    deadlineHits * 5 +
    (args.extracted.urls.length > 0 ? 7 : 0) +
    (args.extracted.attachmentRiskScore > 30 ? 12 : 0) +
    (args.externalSender ? 9 : 0) +
    (args.suspiciousDomain ? 12 : 0) +
    trustRisk * 8 +
    reputationRisk * 9 +
    args.thread.riskDensity * 10;

  const financeScore =
    paymentHits * 16 +
    deadlineHits * 6 +
    (args.extracted.moneyMentions.length > 0 ? 8 : 0) +
    (args.externalSender ? 8 : 0) +
    trustRisk * 6 +
    reputationRisk * 7 +
    args.thread.riskDensity * 8;

  const legalScore = legalHits * 16 + (args.extracted.deadlines.length > 0 ? 6 : 0) + args.thread.depth * 1.5;
  const deadlineScore = scheduleHits * 9 + deadlineHits * 12 + args.thread.depth * 1.8 + args.thread.riskDensity * 7;
  const executiveScore = execHits * 14 + deadlineHits * 3 + (args.externalSender ? 3 : 0);
  const salesScore = salesHits * 12 + (newsletterHits > 0 ? 4 : 0) - securityHits * 3;
  const supportScore = supportHits * 13 + scheduleHits * 5;
  const newsletterScore =
    newsletterHits * 15 + (args.externalSender ? 2 : 0) - securityHits * 8 - paymentHits * 6 - deadlineHits * 4;
  const generalScore = 14 + scheduleHits * 2 + (args.externalSender ? 1 : 0);

  const categories: CategoryScore[] = [
    {
      category: "scam_bec",
      score: clamp(Math.round(scamBecScore), 0, 100),
      reason: `exec=${execHits}, impersonation=${impersonationHits}, urgency=${deadlineHits}`,
    },
    {
      category: "scam_invoice_fraud",
      score: clamp(Math.round(scamInvoiceScore), 0, 100),
      reason: `payment=${paymentHits}, moneyMentions=${args.extracted.moneyMentions.length}, urgency=${deadlineHits}`,
    },
    {
      category: "scam_credential_phishing",
      score: clamp(Math.round(scamCredentialScore), 0, 100),
      reason: `security=${securityHits}, urls=${args.extracted.urls.length}, suspiciousDomain=${args.suspiciousDomain}`,
    },
    {
      category: "scam_malware_attachment",
      score: clamp(Math.round(scamMalwareScore), 0, 100),
      reason: `malware=${malwareHits}, attachmentRisk=${args.extracted.attachmentRiskScore}`,
    },
    {
      category: "scam_impersonation",
      score: clamp(Math.round(scamImpersonationScore), 0, 100),
      reason: `impersonation=${impersonationHits}, executive=${execHits}, external=${args.externalSender}`,
    },
    {
      category: "security_phishing",
      score: clamp(Math.round(securityScore), 0, 100),
      reason: `security=${securityHits}, attachmentRisk=${args.extracted.attachmentRiskScore}, trust=${args.trustScore}, reputation=${args.reputationScore}`,
    },
    {
      category: "finance_payment",
      score: clamp(Math.round(financeScore), 0, 100),
      reason: `payment=${paymentHits}, moneyMentions=${args.extracted.moneyMentions.length}, threadDepth=${args.thread.depth}`,
    },
    {
      category: "legal_contract",
      score: clamp(Math.round(legalScore), 0, 100),
      reason: `legal=${legalHits}, deadlines=${args.extracted.deadlines.length}`,
    },
    {
      category: "deadline_scheduling",
      score: clamp(Math.round(deadlineScore), 0, 100),
      reason: `deadline/scheduling=${deadlineHits + scheduleHits}, threadDepth=${args.thread.depth}`,
    },
    {
      category: "executive_escalation",
      score: clamp(Math.round(executiveScore), 0, 100),
      reason: `executive=${execHits}`,
    },
    {
      category: "sales_marketing",
      score: clamp(Math.round(salesScore), 0, 100),
      reason: `sales=${salesHits}`,
    },
    {
      category: "ops_support",
      score: clamp(Math.round(supportScore), 0, 100),
      reason: `support=${supportHits}`,
    },
    {
      category: "newsletter",
      score: clamp(Math.round(newsletterScore), 0, 100),
      reason: `newsletter=${newsletterHits}`,
    },
    {
      category: "general",
      score: clamp(Math.round(generalScore), 0, 100),
      reason: "fallback category",
    },
  ];

  return categories.sort((a, b) => b.score - a.score);
}

function scoreOfCategory(categoryScores: CategoryScore[], category: Category): number {
  return categoryScores.find((entry) => entry.category === category)?.score ?? 0;
}

function isScamCategory(category: Category): boolean {
  return (
    category === "scam_bec" ||
    category === "scam_invoice_fraud" ||
    category === "scam_credential_phishing" ||
    category === "scam_malware_attachment" ||
    category === "scam_impersonation"
  );
}

function scoreEmail(args: {
  parsed: ParsedEmail;
  orgDomains: string[];
  trustScore: number;
  reputation: ReputationProfile;
  thread: ThreadProfile;
}): Omit<ScoredEmail, keyof ParsedEmail | "baseUncertaintyPercent" | "evidenceStrength"> {
  const text = `${args.parsed.subject}\n${args.parsed.body}`;
  const securityHits = countHits(text, PATTERNS.security);
  const paymentHits = countHits(text, PATTERNS.payment);
  const legalHits = countHits(text, PATTERNS.legal);
  const deadlineHits = countHits(text, PATTERNS.deadline);
  const execHits = countHits(text, PATTERNS.executive);
  const impersonationHits = countHits(text, PATTERNS.impersonation);

  const suspiciousDomain =
    !!args.parsed.senderDomain && SUSPICIOUS_TLDS.some((tld) => args.parsed.senderDomain.endsWith(tld));
  const externalSender =
    !!args.parsed.senderDomain && !args.orgDomains.some((domain) => domain.toLowerCase() === args.parsed.senderDomain);

  const categoryScores = buildCategoryScores({
    text,
    externalSender,
    suspiciousDomain,
    extracted: args.parsed.extracted,
    trustScore: args.trustScore,
    reputationScore: args.reputation.score,
    thread: args.thread,
  });

  const primaryCategory = categoryScores[0].score >= 18 ? categoryScores[0].category : "general";
  const scamBecScore = scoreOfCategory(categoryScores, "scam_bec");
  const scamInvoiceScore = scoreOfCategory(categoryScores, "scam_invoice_fraud");
  const scamCredentialScore = scoreOfCategory(categoryScores, "scam_credential_phishing");
  const scamMalwareScore = scoreOfCategory(categoryScores, "scam_malware_attachment");
  const scamImpersonationScore = scoreOfCategory(categoryScores, "scam_impersonation");
  const securityScore = scoreOfCategory(categoryScores, "security_phishing");
  const financeScore = scoreOfCategory(categoryScores, "finance_payment");
  const legalScore = scoreOfCategory(categoryScores, "legal_contract");
  const deadlineScore = scoreOfCategory(categoryScores, "deadline_scheduling");
  const executiveScore = scoreOfCategory(categoryScores, "executive_escalation");
  const newsletterScore = scoreOfCategory(categoryScores, "newsletter");

  let priorityScore =
    8 +
    scamBecScore * 0.5 +
    scamInvoiceScore * 0.48 +
    scamCredentialScore * 0.5 +
    scamMalwareScore * 0.46 +
    scamImpersonationScore * 0.46 +
    securityScore * 0.5 +
    financeScore * 0.44 +
    legalScore * 0.34 +
    executiveScore * 0.2 +
    deadlineScore * 0.18 +
    (externalSender ? 10 : 0) +
    (suspiciousDomain ? 10 : 0) +
    (args.parsed.extracted.attachmentRiskScore > 40 ? 10 : 0) +
    Math.min(10, Math.round((50 - args.trustScore) * 0.2)) +
    Math.min(10, Math.round((50 - args.reputation.score) * 0.2)) +
    Math.round(args.thread.riskDensity * 10);

  const criticalSecurityCombo =
    securityScore >= 58 &&
    externalSender &&
    (args.parsed.extracted.urls.length > 0 || args.parsed.extracted.attachmentRiskScore >= 35);

  const criticalFinanceCombo =
    financeScore >= 62 &&
    externalSender &&
    deadlineHits > 0;

  const criticalScamCombo =
    Math.max(
      scamBecScore,
      scamInvoiceScore,
      scamCredentialScore,
      scamMalwareScore,
      scamImpersonationScore
    ) >= 72;

  if (criticalSecurityCombo) priorityScore += 16;
  if (criticalFinanceCombo) priorityScore += 14;
  if (criticalScamCombo) priorityScore += 18;
  if (args.thread.depth >= 3 && args.thread.riskDensity >= 0.45) priorityScore += 6;

  if (newsletterScore >= 50 && securityHits === 0 && paymentHits === 0 && legalHits === 0) {
    priorityScore -= 16;
  }

  priorityScore = clamp(Math.round(priorityScore), 0, 100);
  if (criticalSecurityCombo || criticalFinanceCombo || criticalScamCombo) {
    priorityScore = Math.max(priorityScore, criticalScamCombo ? 88 : 82);
  }

  const priority: Priority = priorityScore >= 80 ? "high" : priorityScore >= 50 ? "medium" : "low";

  const riskTags: string[] = [];
  if (scamBecScore >= 40) riskTags.push("BEC Scam");
  if (scamInvoiceScore >= 40) riskTags.push("Invoice Scam");
  if (scamCredentialScore >= 40) riskTags.push("Credential Phishing");
  if (scamMalwareScore >= 40) riskTags.push("Malware Risk");
  if (scamImpersonationScore >= 40) riskTags.push("Impersonation");
  if (securityScore >= 35) riskTags.push("Security");
  if (financeScore >= 35) riskTags.push("Payment");
  if (legalScore >= 35) riskTags.push("Legal");
  if (externalSender) riskTags.push("External Sender");
  if (suspiciousDomain) riskTags.push("Suspicious Domain");
  if (deadlineHits > 0) riskTags.push("Deadline Pressure");
  if (execHits > 0) riskTags.push("Executive Escalation");
  if (impersonationHits > 0) riskTags.push("Impersonation Language");
  if (args.parsed.extracted.attachmentRiskScore > 40) riskTags.push("Suspicious Attachment");
  if (args.reputation.score <= 45) riskTags.push("Weak Entity Reputation");
  if (args.trustScore <= 30) riskTags.push("Low Historical Trust");

  const signals: string[] = [];
  if (securityHits > 0) signals.push(`${securityHits} credential/authentication signal(s)`);
  if (paymentHits > 0) signals.push(`${paymentHits} payment/transfer signal(s)`);
  if (legalHits > 0) signals.push(`${legalHits} legal/contract signal(s)`);
  if (deadlineHits > 0) signals.push(`${deadlineHits} urgency/deadline signal(s)`);
  if (args.parsed.extracted.attachmentRiskScore > 0) {
    signals.push(`attachment risk score ${args.parsed.extracted.attachmentRiskScore}/100`);
  }
  if (externalSender) signals.push("sender appears external to organization domains");
  if (suspiciousDomain) signals.push("sender domain uses suspicious TLD pattern");
  if (criticalSecurityCombo) signals.push("critical combo: external + security + URL/attachment");
  if (criticalFinanceCombo) signals.push("critical combo: external + finance + urgency");
  if (criticalScamCombo) signals.push("critical scam score threshold exceeded");
  if (impersonationHits > 0) signals.push(`${impersonationHits} impersonation signal(s)`);
  if (args.thread.depth > 1) signals.push(`thread depth ${args.thread.depth} with risk density ${args.thread.riskDensity}`);
  if (newsletterScore >= 45) signals.push("newsletter/marketing signature detected");

  return {
    priorityScore,
    priority,
    primaryCategory,
    categoryScores,
    riskTags: Array.from(new Set(riskTags)),
    signals: Array.from(new Set(signals)),
    trustScore: args.trustScore,
    reputation: args.reputation,
    thread: args.thread,
  };
}

function computeBaseUncertainty(args: {
  rawEmail: string;
  priorityScore: number;
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
  categoryScores: CategoryScore[];
  trustScore: number;
  reputationScore: number;
  thread: ThreadProfile;
}): number {
  let uncertainty = 61;
  const rawLen = args.rawEmail.trim().length;

  if (rawLen > 1200) uncertainty -= 9;
  else if (rawLen < 170) uncertainty += 12;

  if (args.signals.length >= 5) uncertainty -= 12;
  else if (args.signals.length <= 1) uncertainty += 10;

  const evidenceCount =
    args.extracted.deadlines.length +
    args.extracted.moneyMentions.length +
    args.extracted.urls.length +
    args.extracted.attachments.length;
  if (evidenceCount >= 4) uncertainty -= 7;
  else if (evidenceCount === 0) uncertainty += 8;

  const top = args.categoryScores[0]?.score ?? 0;
  const second = args.categoryScores[1]?.score ?? 0;
  const spread = top - second;
  if (spread >= 18) uncertainty -= 9;
  else uncertainty += 6;
  if (top < 24) uncertainty += 9;

  if (args.thread.depth >= 3) uncertainty -= 4;
  if (args.thread.riskDensity >= 0.55) uncertainty -= 4;

  uncertainty += Math.round((50 - args.trustScore) * 0.08);
  uncertainty += Math.round((50 - args.reputationScore) * 0.1);

  if (args.priorityScore >= 80) uncertainty -= 4;
  if (args.riskTags.length === 0) uncertainty += 10;

  return clamp(Math.round(uncertainty), 5, 95);
}

function calibrateUncertainty(args: {
  category: Category;
  baseUncertaintyPercent: number;
  evidenceStrength: number;
  trustScore: number;
  reputationScore: number;
  consensusScore: number;
  threadDepth: number;
}): number {
  const profile = CALIBRATION_PROFILES[args.category];
  const baseConfidence = 100 - args.baseUncertaintyPercent;

  const evidenceConfidence = clamp(
    args.evidenceStrength * 0.55 +
      args.trustScore * 0.15 +
      args.reputationScore * 0.15 +
      args.consensusScore * 0.15,
    0,
    100
  );

  let calibratedConfidence =
    baseConfidence * profile.reliabilityWeight + evidenceConfidence * (1 - profile.reliabilityWeight);
  calibratedConfidence = calibratedConfidence * profile.slope + profile.offset;
  calibratedConfidence += Math.min(8, Math.max(0, args.threadDepth - 1) * 1.4);
  calibratedConfidence = clamp(calibratedConfidence, 2, 98);

  return clamp(Math.round(100 - calibratedConfidence), 2, 98);
}

const LLMOutSchema = z.object({
  suggestedAction: z.string(),
  draftReply: z.string(),
});

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function jaccardScore(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const token of sa) {
    if (sb.has(token)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

type TrustedDecision = {
  action: TrustedDecisionAction;
  confidencePct: number;
  riskScore: number;
  note: string;
};

type AssistOutput = {
  suggestedAction: string;
  draftReply: string;
  consensusScore: number;
  consensusNote: string;
};

function buildTrustedDecision(args: {
  email: ScoredEmail;
  uncertaintyPercent: number;
}): TrustedDecision {
  let riskScore = Math.round(
    args.email.priorityScore * 0.58 +
      (100 - args.email.trustScore) * 0.21 +
      (100 - args.email.reputation.score) * 0.21
  );

  if (isScamCategory(args.email.primaryCategory)) riskScore += 12;
  if (args.email.riskTags.includes("External Sender")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.senderMismatch;
  }
  if (args.email.riskTags.includes("Deadline Pressure")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.urgentLanguage;
  }
  if (args.email.riskTags.includes("Payment") || args.email.riskTags.includes("Invoice Scam")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.paymentRequest;
  }
  if (args.email.riskTags.includes("Security") || args.email.riskTags.includes("Credential Phishing")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.credentialRequest;
  }
  if (args.email.extracted.urls.length > 0 && args.email.riskTags.includes("Suspicious Domain")) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.suspiciousUrl;
  }
  if (args.email.extracted.attachmentRiskScore >= 30) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.suspiciousAttachment;
  }
  if (
    args.email.riskTags.includes("Impersonation") ||
    args.email.riskTags.includes("Executive Escalation") ||
    args.email.riskTags.includes("Impersonation Language")
  ) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.spoofingIndicators;
  }
  if (args.email.trustScore <= 35) {
    riskScore += OFFLINE_MODE_TEMPLATE_WEIGHTS.lowHistoricalTrust;
  }

  riskScore = clamp(riskScore, 0, 100);

  let action: TrustedDecisionAction = "allow";
  if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.blockAtOrAbove) {
    action = "block";
  } else if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.quarantineAtOrAbove) {
    action = "quarantine";
  } else if (riskScore >= OFFLINE_MODE_TEMPLATE_THRESHOLDS.escalateAtOrAbove) {
    action = "escalate";
  }

  const confidencePct = clamp(
    Math.round((100 - args.uncertaintyPercent) * 0.75 + Math.min(22, riskScore * 0.22)),
    5,
    99
  );

  let note = "Low-risk message. Allow with routine review.";
  if (action === "escalate") {
    note = "Medium risk detected. Escalate for human verification.";
  } else if (action === "quarantine") {
    note = "High risk detected. Quarantine until sender/request is verified.";
  } else if (action === "block") {
    note = "Critical scam indicators detected. Block and open security incident.";
  }

  return { action, confidencePct, riskScore, note };
}

function offlineAssistFromPolicy(args: {
  from: string;
  subject: string;
  trustedDecision: TrustedDecision;
  primaryCategory: Category;
  riskTags: string[];
}): AssistOutput {
  const identityStep =
    "verify sender identity using a known internal channel before any action on this request";
  const actionByCategory: Record<Category, string> = {
    scam_bec: `Potential BEC pattern detected; ${identityStep}.`,
    scam_invoice_fraud: `Potential invoice fraud pattern detected; ${identityStep}.`,
    scam_credential_phishing: `Potential credential phishing pattern detected; ${identityStep}.`,
    scam_malware_attachment: `Potential malware attachment pattern detected; isolate attachments and ${identityStep}.`,
    scam_impersonation: `Potential impersonation pattern detected; ${identityStep}.`,
    security_phishing: `Security risk signals detected; ${identityStep}.`,
    finance_payment: `Payment risk signals detected; confirm payment details through trusted channels.`,
    legal_contract: "Review legal terms with legal/compliance before replying.",
    deadline_scheduling: "Confirm deadlines and owners, then send a structured acknowledgement.",
    executive_escalation: "Validate executive request authenticity through known contacts.",
    sales_marketing: "Low-risk commercial message; proceed with normal qualification.",
    ops_support: "Operational support signal detected; route to support queue.",
    newsletter: "Likely newsletter/marketing communication; no sensitive action needed.",
    general: "General communication; request clarification if action is ambiguous.",
  };

  const action = actionByCategory[args.primaryCategory];
  const riskSummary = args.riskTags.slice(0, 4).join(", ") || "No high-risk tags";
  const suggestedAction = `${action} Decision: ${args.trustedDecision.action.toUpperCase()} (${args.trustedDecision.riskScore}/100 risk).`;

  const draftReply = `Hello,

Thank you for the message regarding "${args.subject}".
Before I proceed, I need to complete internal verification for sender identity and request details.
I will confirm next steps after verification is complete.

Regards`;

  return {
    suggestedAction,
    draftReply,
    consensusScore: args.trustedDecision.confidencePct,
    consensusNote: `Offline deterministic policy applied (${riskSummary}).`,
  };
}

async function runAssistModel(args: {
  model: string;
  style: string;
  rawEmail: string;
  from: string;
  subject: string;
  priority: Priority;
  priorityScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
}): Promise<z.infer<typeof LLMOutSchema> | null> {
  const prompt = `
You are an inbox triage assistant (${args.style}).
Use ONLY the email and provided signals.
Output strict JSON:
- suggestedAction: 1 concise sentence with safest next action.
- draftReply: 3-7 professional lines. If no response needed: "No reply needed."

FROM: ${args.from}
SUBJECT: ${args.subject}
PRIORITY: ${args.priority} (${args.priorityScore})
PRIMARY_CATEGORY: ${args.primaryCategory}
TOP_CATEGORY_SCORES: ${JSON.stringify(args.categoryScores.slice(0, 4))}
RISK_TAGS: ${JSON.stringify(args.riskTags)}
SIGNALS: ${JSON.stringify(args.signals)}
DEADLINES: ${JSON.stringify(args.extracted.deadlines)}
MONEY: ${JSON.stringify(args.extracted.moneyMentions)}
URLS: ${JSON.stringify(args.extracted.urls)}
ATTACHMENTS: ${JSON.stringify(args.extracted.attachments)}

EMAIL_RAW:
${args.rawEmail}
`;

  try {
    const obj = await generateObject({
      model: openai(args.model),
      schema: LLMOutSchema,
      prompt,
    });
    return obj.object;
  } catch {
    return null;
  }
}

async function llmAssistWithConsensus(args: {
  rawEmail: string;
  from: string;
  subject: string;
  priority: Priority;
  priorityScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  extracted: ParsedEmail["extracted"];
}) {
  const primaryPromise = runAssistModel({
    ...args,
    model: "gpt-4o-mini",
    style: "security-first",
  });
  const secondaryPromise = runAssistModel({
    ...args,
    model: "gpt-4.1-mini",
    style: "compliance-first",
  });

  const [primary, secondary] = await Promise.all([primaryPromise, secondaryPromise]);

  if (!primary && !secondary) {
    return {
      suggestedAction: "Review the request and verify the sender before taking action.",
      draftReply: "Thanks for your email. I will verify details through a trusted channel and then confirm next steps.",
      consensusScore: 30,
      consensusNote: "Both reasoning models failed; fallback response used.",
    };
  }

  if (primary && !secondary) {
    return {
      ...primary,
      consensusScore: 52,
      consensusNote: "Single-model response (secondary model unavailable).",
    };
  }

  if (!primary && secondary) {
    return {
      ...secondary,
      consensusScore: 52,
      consensusNote: "Single-model response (primary model unavailable).",
    };
  }

  const actionSim = jaccardScore(primary!.suggestedAction, secondary!.suggestedAction);
  const draftSim = jaccardScore(primary!.draftReply, secondary!.draftReply);
  const consensusScore = clamp(Math.round((actionSim * 0.6 + draftSim * 0.4) * 100), 0, 100);

  if (consensusScore >= 58) {
    return {
      ...primary!,
      consensusScore,
      consensusNote: "High agreement between two model perspectives.",
    };
  }

  return {
    suggestedAction:
      "Model outputs disagree; verify sender identity and request details via a known trusted channel before responding.",
    draftReply:
      "Thank you for your message.\nBefore proceeding, I need to verify the request and sender details through a trusted channel.\nI will follow up once verification is complete.",
    consensusScore,
    consensusNote: "Low model agreement; conservative consensus output applied.",
  };
}

async function getEmails(
  input: z.infer<typeof InboxRequestSchema>,
  requestUrl: URL,
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<string[]> {
  if (input.mode === "manual") return input.emails;

  const token = await getValidGmailToken(cookieStore, requestUrl);
  if (!token) {
    throw new Error("Gmail is not connected. Connect Gmail from Inbox Scanner first.");
  }

  return fetchLatestGmailRawEmails({
    accessToken: token.accessToken,
    maxResults: input.gmail?.maxResults ?? 20,
    query: input.gmail?.query || "in:inbox",
  });
}

function parseRawEmail(raw: string, id: string): ParsedEmail {
  const from = extractFrom(raw);
  const subject = extractSubject(raw);
  const senderEmail = senderEmailFromFromHeader(from);
  const senderDomain = domainFromFromHeader(from);
  const body = extractBody(raw);

  const deadlines = extractDeadlines(raw);
  const moneyMentions = extractMoneyMentions(raw);
  const urls = extractUrls(raw);
  const urlDomains = extractDomainsFromUrls(urls);
  const { attachments, attachmentRiskScore } = extractAttachments(raw);
  const threadKey = deriveThreadKey(raw, subject, senderDomain);

  return {
    id,
    raw,
    from,
    subject,
    senderEmail,
    senderDomain,
    body,
    threadKey,
    extracted: {
      deadlines,
      moneyMentions,
      urls,
      attachments,
      attachmentRiskScore,
      urlDomains,
    },
  };
}

export async function POST(req: Request) {
  try {
    const offlineConfig = getOfflineRuntimeConfig();
    const offlineEnforced = isOfflineEnforced(offlineConfig);

    const body = await req.json();
    const parsed = InboxRequestSchema.parse(body);
    const cookieStore = await cookies();

    if (offlineEnforced && parsed.mode === "gmail" && offlineConfig.blockOutboundNetwork) {
      return Response.json(
        {
          error: "Offline mode enforced",
          detail:
            "Gmail fetch is disabled in enforced offline mode because outbound network access is blocked. Use Manual mode.",
          offlineState: offlineConfig.state,
        },
        { status: 503 }
      );
    }

    const orgDomains = (parsed.userContext?.orgDomains || []).map((d) => d.toLowerCase());
    const emails = await getEmails(parsed, new URL(req.url), cookieStore);

    const parsedEmails = emails.map((raw, idx) => parseRawEmail(raw, `email-${idx + 1}`));
    const threadProfiles = buildThreadProfiles(parsedEmails);
    const trustGraph = readTrustGraphCookie(cookieStore.get(TRUST_COOKIE)?.value);

    const scored: ScoredEmail[] = parsedEmails.map((email) => {
      const trustScore = getTrustScore(trustGraph, email.senderEmail, email.senderDomain);
      const reputation = buildReputationProfile({
        senderDomain: email.senderDomain,
        urlDomains: email.extracted.urlDomains,
        orgDomains,
        trustScore,
      });
      const thread = threadProfiles[email.threadKey] || { key: email.threadKey, depth: 1, riskDensity: 0 };

      const s = scoreEmail({
        parsed: email,
        orgDomains,
        trustScore,
        reputation,
        thread,
      });

      const evidenceStrength = clamp(
        Math.round(s.categoryScores[0].score * 0.65 + (s.signals.length * 4 + s.riskTags.length * 3)),
        0,
        100
      );
      const baseUncertaintyPercent = computeBaseUncertainty({
        rawEmail: email.raw,
        priorityScore: s.priorityScore,
        riskTags: s.riskTags,
        signals: s.signals,
        extracted: email.extracted,
        categoryScores: s.categoryScores,
        trustScore: s.trustScore,
        reputationScore: s.reputation.score,
        thread: s.thread,
      });

      return {
        ...email,
        ...s,
        baseUncertaintyPercent,
        evidenceStrength,
      };
    });

    scored.sort((a, b) => b.priorityScore - a.priorityScore);
    const TOP_N = offlineEnforced ? scored.length : Math.min(8, scored.length);

    const alerts: Alert[] = await Promise.all(
      scored.slice(0, TOP_N).map(async (email) => {
        const seedDecision = buildTrustedDecision({
          email,
          uncertaintyPercent: email.baseUncertaintyPercent,
        });

        const llm = offlineEnforced
          ? offlineAssistFromPolicy({
              from: email.from,
              subject: email.subject,
              trustedDecision: seedDecision,
              primaryCategory: email.primaryCategory,
              riskTags: email.riskTags,
            })
          : await llmAssistWithConsensus({
              rawEmail: email.raw,
              from: email.from,
              subject: email.subject,
              priority: email.priority,
              priorityScore: email.priorityScore,
              primaryCategory: email.primaryCategory,
              categoryScores: email.categoryScores,
              riskTags: email.riskTags,
              signals: email.signals,
              extracted: email.extracted,
            });

        const uncertaintyPercent = calibrateUncertainty({
          category: email.primaryCategory,
          baseUncertaintyPercent: email.baseUncertaintyPercent,
          evidenceStrength: email.evidenceStrength,
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          consensusScore: llm.consensusScore,
          threadDepth: email.thread.depth,
        });
        const trustedDecision = buildTrustedDecision({ email, uncertaintyPercent });
        const finalAssist = offlineEnforced
          ? offlineAssistFromPolicy({
              from: email.from,
              subject: email.subject,
              trustedDecision,
              primaryCategory: email.primaryCategory,
              riskTags: email.riskTags,
            })
          : llm;

        return {
          id: email.id,
          from: email.from,
          senderEmail: email.senderEmail || "",
          senderDomain: email.senderDomain || "",
          subject: email.subject,
          priorityScore: email.priorityScore,
          priority: email.priority,
          primaryCategory: email.primaryCategory,
          categoryScores: email.categoryScores,
          riskTags: email.riskTags,
          signals: email.signals,
          suggestedAction: finalAssist.suggestedAction,
          draftReply: finalAssist.draftReply,
          consensusScore: finalAssist.consensusScore,
          consensusNote: finalAssist.consensusNote,
          trustedDecision,
          trustScore: email.trustScore,
          reputationScore: email.reputation.score,
          reputationFindings: email.reputation.findings,
          thread: email.thread,
          uncertaintyPercent,
          baseUncertaintyPercent: email.baseUncertaintyPercent,
          rawEmail: email.raw,
          extracted: {
            deadlines: email.extracted.deadlines,
            moneyMentions: email.extracted.moneyMentions,
            urls: email.extracted.urls,
            attachments: email.extracted.attachments,
            attachmentRiskScore: email.extracted.attachmentRiskScore,
          },
        };
      })
    );

    for (let i = TOP_N; i < scored.length; i++) {
      const email = scored[i];
      const uncertaintyPercent = calibrateUncertainty({
        category: email.primaryCategory,
        baseUncertaintyPercent: email.baseUncertaintyPercent,
        evidenceStrength: email.evidenceStrength,
        trustScore: email.trustScore,
        reputationScore: email.reputation.score,
        consensusScore: 50,
        threadDepth: email.thread.depth,
      });
      const trustedDecision = buildTrustedDecision({ email, uncertaintyPercent });

      alerts.push({
        id: email.id,
        from: email.from,
        senderEmail: email.senderEmail || "",
        senderDomain: email.senderDomain || "",
        subject: email.subject,
        priorityScore: email.priorityScore,
        priority: email.priority,
        primaryCategory: email.primaryCategory,
        categoryScores: email.categoryScores,
        riskTags: email.riskTags,
        signals: email.signals,
        suggestedAction: "No action suggested (not analyzed).",
        draftReply: "No reply needed.",
        consensusScore: 50,
        consensusNote: "Not passed through multi-model draft analysis due to TOP_N budget.",
        trustedDecision,
        trustScore: email.trustScore,
        reputationScore: email.reputation.score,
        reputationFindings: email.reputation.findings,
        thread: email.thread,
        uncertaintyPercent,
        baseUncertaintyPercent: email.baseUncertaintyPercent,
        rawEmail: email.raw,
        extracted: {
          deadlines: email.extracted.deadlines,
          moneyMentions: email.extracted.moneyMentions,
          urls: email.extracted.urls,
          attachments: email.extracted.attachments,
          attachmentRiskScore: email.extracted.attachmentRiskScore,
        },
      });
    }

    for (const alert of alerts) {
      updateTrustGraph(trustGraph, alert.senderEmail, alert.senderDomain, alert.priority);
    }
    writeTrustGraphCookie(cookieStore, trustGraph);

    const meta = {
      mode: parsed.mode,
      processingMode: offlineEnforced ? "offline_enforced" : "hybrid_remote_llm",
      offlineState: offlineConfig.state,
      scanned: scored.length,
      highCount: alerts.filter((a) => a.priority === "high").length,
      mediumCount: alerts.filter((a) => a.priority === "medium").length,
      lowCount: alerts.filter((a) => a.priority === "low").length,
    };

    return Response.json(InboxResponseSchema.parse({ ok: true, alerts, meta }));
  } catch (err: unknown) {
    console.error("Inbox error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Inbox scan failed", detail }, { status: 500 });
  }
}
