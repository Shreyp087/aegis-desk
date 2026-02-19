import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { cookies } from "next/headers";
import { z } from "zod";

import { fetchLatestGmailRawEmails, getValidGmailToken } from "@/lib/inbox/gmail";

type Category =
  | "security_phishing"
  | "finance_payment"
  | "legal_contract"
  | "deadline_scheduling"
  | "executive_escalation"
  | "sales_marketing"
  | "ops_support"
  | "newsletter"
  | "general";

const CategoryEnum = z.enum([
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

const PriorityEnum = z.enum(["high", "medium", "low"]);
type Priority = z.infer<typeof PriorityEnum>;

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
  uncertaintyPercent: z.number().min(0).max(100),
  priority: PriorityEnum,
  primaryCategory: CategoryEnum,
  categoryScores: z.array(CategoryScoreSchema),
  riskTags: z.array(z.string()),
  signals: z.array(z.string()),
  suggestedAction: z.string(),
  draftReply: z.string(),
  rawEmail: z.string(),
  extracted: z.object({
    deadlines: z.array(z.string()),
    moneyMentions: z.array(z.string()),
    urls: z.array(z.string()),
  }),
});

type Alert = z.infer<typeof AlertSchema>;

const InboxResponseSchema = z.object({
  ok: z.literal(true),
  alerts: z.array(AlertSchema),
  meta: z.object({
    mode: z.string(),
    scanned: z.number(),
    highCount: z.number(),
    mediumCount: z.number(),
    lowCount: z.number(),
  }),
});

type CategoryScore = {
  category: Category;
  score: number;
  reason: string;
};

const PATTERNS = {
  security: [
    /\bpassword\b/i,
    /\bcredentials?\b/i,
    /\blogin\b/i,
    /\breset\b/i,
    /\b2fa\b/i,
    /\bmfa\b/i,
    /\bverify your account\b/i,
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
    .filter((line) => !/^(from:|to:|subject:|date:)\s*/i.test(line))
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
  return Array.from(out).slice(0, 6);
}

function extractMoneyMentions(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [/\$\s?\d[\d,]*(?:\.\d{2})?/g, /\bUSD\s?\d[\d,]*(?:\.\d{2})?\b/gi];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m) m.forEach((x) => out.add(x.trim()));
  }
  return Array.from(out).slice(0, 6);
}

function extractUrls(raw: string): string[] {
  const out = new Set<string>();
  const re = /\bhttps?:\/\/[^\s)]+/gi;
  const m = raw.match(re);
  if (m) m.forEach((x) => out.add(x.trim()));
  return Array.from(out).slice(0, 6);
}

function buildCategoryScores(args: {
  text: string;
  externalSender: boolean;
  suspiciousDomain: boolean;
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
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

  const urlBoost = args.extracted.urls.length > 0 ? 1 : 0;
  const moneyBoost = args.extracted.moneyMentions.length > 0 ? 1 : 0;
  const deadlineBoost = args.extracted.deadlines.length > 0 ? 1 : 0;

  const securityScore =
    securityHits * 18 +
    deadlineHits * 6 +
    urlBoost * 7 +
    (args.externalSender ? 8 : 0) +
    (args.suspiciousDomain ? 12 : 0) +
    (paymentHits > 0 ? 4 : 0);

  const financeScore =
    paymentHits * 16 +
    deadlineHits * 5 +
    moneyBoost * 8 +
    (args.externalSender ? 7 : 0) +
    (securityHits > 0 ? 4 : 0);

  const legalScore = legalHits * 16 + deadlineBoost * 6 + (args.externalSender ? 4 : 0);
  const deadlineScore = scheduleHits * 9 + deadlineHits * 12 + (args.externalSender ? 2 : 0);
  const executiveScore = execHits * 14 + deadlineHits * 3 + (args.externalSender ? 3 : 0);
  const salesScore = salesHits * 12 + (newsletterHits > 0 ? 4 : 0) - securityHits * 3;
  const supportScore = supportHits * 13 + scheduleHits * 5;
  const newsletterScore =
    newsletterHits * 15 + (args.externalSender ? 2 : 0) - securityHits * 8 - paymentHits * 6 - deadlineHits * 4;
  const generalScore = 15 + (scheduleHits > 0 ? 2 : 0) + (args.externalSender ? 1 : 0);

  const categories: CategoryScore[] = [
    {
      category: "security_phishing",
      score: clamp(Math.round(securityScore), 0, 100),
      reason: `Security patterns=${securityHits}, links=${args.extracted.urls.length}, external=${args.externalSender ? "yes" : "no"}`,
    },
    {
      category: "finance_payment",
      score: clamp(Math.round(financeScore), 0, 100),
      reason: `Payment patterns=${paymentHits}, money mentions=${args.extracted.moneyMentions.length}`,
    },
    {
      category: "legal_contract",
      score: clamp(Math.round(legalScore), 0, 100),
      reason: `Legal patterns=${legalHits}, deadlines=${args.extracted.deadlines.length}`,
    },
    {
      category: "deadline_scheduling",
      score: clamp(Math.round(deadlineScore), 0, 100),
      reason: `Deadline/scheduling patterns=${deadlineHits + scheduleHits}`,
    },
    {
      category: "executive_escalation",
      score: clamp(Math.round(executiveScore), 0, 100),
      reason: `Executive markers=${execHits}`,
    },
    {
      category: "sales_marketing",
      score: clamp(Math.round(salesScore), 0, 100),
      reason: `Sales markers=${salesHits}`,
    },
    {
      category: "ops_support",
      score: clamp(Math.round(supportScore), 0, 100),
      reason: `Support markers=${supportHits}`,
    },
    {
      category: "newsletter",
      score: clamp(Math.round(newsletterScore), 0, 100),
      reason: `Newsletter markers=${newsletterHits}`,
    },
    {
      category: "general",
      score: clamp(Math.round(generalScore), 0, 100),
      reason: "Fallback category when specialized signals are weak",
    },
  ];

  return categories.sort((a, b) => b.score - a.score);
}

function scoreEmail(args: {
  raw: string;
  orgDomains: string[];
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
}) {
  const from = extractFrom(args.raw);
  const subject = extractSubject(args.raw);
  const body = extractBody(args.raw);
  const senderDomain = domainFromFromHeader(from);
  const text = `${subject}\n${body}`;

  const securityHits = countHits(text, PATTERNS.security);
  const paymentHits = countHits(text, PATTERNS.payment);
  const legalHits = countHits(text, PATTERNS.legal);
  const deadlineHits = countHits(text, PATTERNS.deadline);
  const execHits = countHits(text, PATTERNS.executive);

  const suspiciousDomain =
    !!senderDomain &&
    [".xyz", ".top", ".click", ".icu", ".ru"].some((tld) => senderDomain.endsWith(tld));
  const externalSender =
    !!senderDomain && !args.orgDomains.some((domain) => domain.toLowerCase() === senderDomain);

  const categoryScores = buildCategoryScores({
    text,
    externalSender,
    suspiciousDomain,
    extracted: args.extracted,
  });

  const primaryCategory = categoryScores[0].score >= 20 ? categoryScores[0].category : "general";

  let priorityScore =
    8 +
    categoryScores.find((c) => c.category === "security_phishing")!.score * 0.5 +
    categoryScores.find((c) => c.category === "finance_payment")!.score * 0.44 +
    categoryScores.find((c) => c.category === "legal_contract")!.score * 0.34 +
    categoryScores.find((c) => c.category === "executive_escalation")!.score * 0.22 +
    categoryScores.find((c) => c.category === "deadline_scheduling")!.score * 0.18 +
    (externalSender ? 10 : 0) +
    (suspiciousDomain ? 12 : 0) +
    Math.min(12, deadlineHits * 3);

  const criticalSecurityCombo =
    categoryScores.find((c) => c.category === "security_phishing")!.score >= 55 &&
    externalSender &&
    args.extracted.urls.length > 0;
  const criticalFinanceCombo =
    categoryScores.find((c) => c.category === "finance_payment")!.score >= 60 &&
    externalSender &&
    deadlineHits > 0;

  if (criticalSecurityCombo) priorityScore += 20;
  if (criticalFinanceCombo) priorityScore += 18;

  const newsletterScore = categoryScores.find((c) => c.category === "newsletter")!.score;
  if (newsletterScore >= 45 && securityHits === 0 && paymentHits === 0) {
    priorityScore -= 18;
  }

  priorityScore = clamp(Math.round(priorityScore), 0, 100);
  if (criticalSecurityCombo || criticalFinanceCombo) {
    priorityScore = Math.max(priorityScore, 82);
  }

  const priority: Priority = priorityScore >= 80 ? "high" : priorityScore >= 50 ? "medium" : "low";

  const riskTags: string[] = [];
  if (categoryScores.find((c) => c.category === "security_phishing")!.score >= 35) riskTags.push("Security");
  if (categoryScores.find((c) => c.category === "finance_payment")!.score >= 35) riskTags.push("Payment");
  if (categoryScores.find((c) => c.category === "legal_contract")!.score >= 35) riskTags.push("Legal");
  if (externalSender) riskTags.push("External Sender");
  if (suspiciousDomain) riskTags.push("Suspicious Domain");
  if (deadlineHits > 0) riskTags.push("Deadline Pressure");
  if (execHits > 0) riskTags.push("Executive Escalation");

  const signals: string[] = [];
  if (securityHits > 0) signals.push(`${securityHits} security credential/access signal(s) detected`);
  if (paymentHits > 0) signals.push(`${paymentHits} payment or transfer signal(s) detected`);
  if (legalHits > 0) signals.push(`${legalHits} legal/contractual signal(s) detected`);
  if (deadlineHits > 0) signals.push(`${deadlineHits} urgency/deadline signal(s) detected`);
  if (externalSender) signals.push("Sender appears external to your known organization domain(s)");
  if (suspiciousDomain) signals.push("Sender domain has suspicious TLD pattern");
  if (criticalSecurityCombo) signals.push("High-risk combo: external sender + security language + URL");
  if (criticalFinanceCombo) signals.push("High-risk combo: external sender + finance request + urgency");
  if (newsletterScore >= 45) signals.push("Newsletter/marketing signal profile detected");

  return {
    priorityScore,
    priority,
    primaryCategory,
    categoryScores,
    riskTags: Array.from(new Set(riskTags)),
    signals: Array.from(new Set(signals)),
  };
}

function computeUncertaintyPercent(args: {
  rawEmail: string;
  priorityScore: number;
  riskTags: string[];
  signals: string[];
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
  categoryScores: CategoryScore[];
}): number {
  let uncertainty = 62;
  const rawLen = args.rawEmail.trim().length;

  if (rawLen > 1200) uncertainty -= 10;
  else if (rawLen < 180) uncertainty += 12;

  if (args.signals.length >= 4) uncertainty -= 12;
  else if (args.signals.length <= 1) uncertainty += 10;

  const evidenceCount =
    args.extracted.deadlines.length + args.extracted.moneyMentions.length + args.extracted.urls.length;
  if (evidenceCount >= 3) uncertainty -= 7;
  else if (evidenceCount === 0) uncertainty += 8;

  const top = args.categoryScores[0]?.score ?? 0;
  const second = args.categoryScores[1]?.score ?? 0;
  const spread = top - second;
  if (spread >= 18) uncertainty -= 10;
  else uncertainty += 6;
  if (top < 24) uncertainty += 10;

  if (args.riskTags.includes("Suspicious Domain")) uncertainty -= 6;
  if (args.priorityScore >= 80) uncertainty -= 5;
  if (args.riskTags.length === 0) uncertainty += 10;

  return clamp(Math.round(uncertainty), 5, 95);
}

const LLMOutSchema = z.object({
  suggestedAction: z.string(),
  draftReply: z.string(),
});

async function llmAssist(args: {
  rawEmail: string;
  from: string;
  subject: string;
  priority: Priority;
  priorityScore: number;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
}) {
  const prompt = `
You are an inbox triage assistant for professionals.

Use ONLY the provided email text and detected signals.
Do NOT invent facts.

Output:
- suggestedAction: 1 concise sentence with the safest next step.
- draftReply: a short professional reply (3-7 lines). If no reply needed, write "No reply needed."

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

EMAIL_RAW:
${args.rawEmail}
`;

  try {
    const obj = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: LLMOutSchema,
      prompt,
    });
    return obj.object;
  } catch {
    return {
      suggestedAction: "Review the request and verify the sender before taking any action.",
      draftReply: "Thanks for the message. I will review and confirm through a verified channel.",
    };
  }
}

type InboxRequest = z.infer<typeof InboxRequestSchema>;

async function getEmails(input: InboxRequest, requestUrl: URL): Promise<string[]> {
  if (input.mode === "manual") return input.emails;

  const cookieStore = await cookies();
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

type ScoredEmail = {
  id: string;
  raw: string;
  from: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
  priorityScore: number;
  uncertaintyPercent: number;
  priority: Priority;
  primaryCategory: Category;
  categoryScores: CategoryScore[];
  riskTags: string[];
  signals: string[];
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = InboxRequestSchema.parse(body);

    const orgDomains = (parsed.userContext?.orgDomains || []).map((d) => d.toLowerCase());
    const emails = await getEmails(parsed, new URL(req.url));

    const scored: ScoredEmail[] = emails.map((raw, idx) => {
      const subject = extractSubject(raw);
      const from = extractFrom(raw);
      const senderEmail = senderEmailFromFromHeader(from);
      const senderDomain = domainFromFromHeader(from);
      const extracted = {
        deadlines: extractDeadlines(raw),
        moneyMentions: extractMoneyMentions(raw),
        urls: extractUrls(raw),
      };

      const s = scoreEmail({ raw, orgDomains, extracted });
      const uncertaintyPercent = computeUncertaintyPercent({
        rawEmail: raw,
        priorityScore: s.priorityScore,
        riskTags: s.riskTags,
        signals: s.signals,
        extracted,
        categoryScores: s.categoryScores,
      });

      return {
        id: `email-${idx + 1}`,
        raw,
        from,
        senderEmail,
        senderDomain,
        subject,
        extracted,
        uncertaintyPercent,
        ...s,
      };
    });

    scored.sort((a, b) => b.priorityScore - a.priorityScore);
    const TOP_N = Math.min(8, scored.length);

    const alerts: Alert[] = await Promise.all(
      scored.slice(0, TOP_N).map(async (email) => {
        const llm = await llmAssist({
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

        return {
          id: email.id,
          from: email.from,
          senderEmail: email.senderEmail || "",
          senderDomain: email.senderDomain || "",
          subject: email.subject,
          priorityScore: email.priorityScore,
          uncertaintyPercent: email.uncertaintyPercent,
          priority: email.priority,
          primaryCategory: email.primaryCategory,
          categoryScores: email.categoryScores,
          riskTags: email.riskTags,
          signals: email.signals,
          suggestedAction: llm.suggestedAction,
          draftReply: llm.draftReply,
          rawEmail: email.raw,
          extracted: email.extracted,
        };
      })
    );

    for (let i = TOP_N; i < scored.length; i++) {
      const email = scored[i];
      alerts.push({
        id: email.id,
        from: email.from,
        senderEmail: email.senderEmail || "",
        senderDomain: email.senderDomain || "",
        subject: email.subject,
        priorityScore: email.priorityScore,
        uncertaintyPercent: email.uncertaintyPercent,
        priority: email.priority,
        primaryCategory: email.primaryCategory,
        categoryScores: email.categoryScores,
        riskTags: email.riskTags,
        signals: email.signals,
        suggestedAction: "No action suggested (not analyzed).",
        draftReply: "No reply needed.",
        rawEmail: email.raw,
        extracted: email.extracted,
      });
    }

    const meta = {
      mode: parsed.mode,
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
