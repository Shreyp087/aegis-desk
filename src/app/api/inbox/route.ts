// src/app/api/inbox/route.ts
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * Inbox Scanner Backend (manual for now, connector-ready later)
 *
 * Request:
 * {
 *   "mode": "manual",
 *   "emails": ["raw email 1...", "raw email 2..."],
 *   "userContext": { "orgDomains": ["yourcompany.com"] } // optional
 * }
 *
 * Response:
 * { "ok": true, "alerts": [...], "meta": {...} }
 */

// ---------- Schemas ----------
const InboxRequestSchema = z.object({
  mode: z.enum(["manual", "gmail"]).default("manual"),
  emails: z.array(z.string()).default([]),
  userContext: z
    .object({
      orgDomains: z.array(z.string()).optional(), // to detect external senders
    })
    .optional(),
});

const PriorityEnum = z.enum(["high", "medium", "low"]);
type Priority = z.infer<typeof PriorityEnum>;

const AlertSchema = z.object({
  id: z.string(),
  from: z.string(),
  senderEmail: z.string(),
  senderDomain: z.string(),
  subject: z.string(),
  priorityScore: z.number().min(0).max(100),
  priority: PriorityEnum,
  riskTags: z.array(z.string()),
  signals: z.array(z.string()),
  suggestedAction: z.string(),
  draftReply: z.string(),
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

// ---------- Signal rules (deterministic scoring) ----------
const SIGNALS: Array<{
  tag: string;
  weight: number;
  patterns: RegExp[];
  label: string;
}> = [
  {
    tag: "Payment",
    weight: 30,
    label: "Payment / money transfer",
    patterns: [/wire\s+transfer/i, /bank\s+details/i, /invoice/i, /payment/i, /\bACH\b/i],
  },
  {
    tag: "Urgent",
    weight: 20,
    label: "Urgency language",
    patterns: [/\burgent\b/i, /\basap\b/i, /immediately/i, /action required/i, /within\s+\d+\s*hours/i],
  },
  {
    tag: "Deadline",
    weight: 15,
    label: "Deadline / time pressure",
    patterns: [/\btoday\b/i, /\btomorrow\b/i, /\bEOD\b/i, /end of day/i, /end of week/i, /by\s+\w+/i],
  },
  {
    tag: "Legal",
    weight: 18,
    label: "Legal / contract content",
    patterns: [/agreement/i, /contract/i, /\bNDA\b/i, /terms/i, /liability/i, /indemnif/i, /signature/i],
  },
  {
    tag: "Security",
    weight: 28,
    label: "Security / credentials",
    patterns: [/password/i, /credentials/i, /2fa/i, /login/i, /verify your account/i, /reset/i],
  },
  {
    tag: "Exec",
    weight: 12,
    label: "Executive escalation",
    patterns: [/\bCEO\b/i, /\bCFO\b/i, /\bCTO\b/i, /\bfounder\b/i, /board/i],
  },
];

// ---------- Basic extraction helpers ----------
function senderEmailFromFromHeader(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const email = (m?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.replace(/[^\w@.+-]/g, "").toLowerCase();
}

function extractHeader(raw: string, key: string): string {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "im");
  const m = raw.match(re);
  return (m?.[1] || "").trim();
}

function extractSubject(raw: string) {
  return extractHeader(raw, "Subject") || "(No subject)";
}

function extractFrom(raw: string) {
  return extractHeader(raw, "From") || "(Unknown sender)";
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

function domainFromFromHeader(from: string): string {
  const emailMatch = from.match(/<([^>]+)>/);
  const email = (emailMatch?.[1] || from).trim();
  const at = email.indexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).replace(/[^\w.-]/g, "").toLowerCase();
}

function scoreEmail(raw: string, orgDomains: string[]) {
  const signals: string[] = [];
  const riskTags: string[] = [];
  let score = 5;

  for (const s of SIGNALS) {
    const hit = s.patterns.some((p) => p.test(raw));
    if (hit) {
      score += s.weight;
      riskTags.push(s.tag);
      signals.push(s.label);
    }
  }

  // External sender detection (deterministic)
  const from = extractFrom(raw);
  const d = domainFromFromHeader(from);
  if (d) {
    const isInternal = orgDomains.some((od) => od.toLowerCase() === d);
    if (!isInternal) {
      score += 10;
      riskTags.push("External Sender");
      signals.push("Sender appears external to your org domain(s)");
    }
  }

  // Cap + priority label (IMPORTANT: annotate to keep literal union)
  score = Math.max(0, Math.min(100, Math.round(score)));
  const priority: Priority = score >= 80 ? "high" : score >= 45 ? "medium" : "low";

  return {
    priorityScore: score,
    priority,
    riskTags: Array.from(new Set(riskTags)),
    signals: Array.from(new Set(signals)),
  };
}

// ---------- LLM: generate suggested action + draft reply ----------
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
  riskTags: string[];
  signals: string[];
  extracted: { deadlines: string[]; moneyMentions: string[]; urls: string[] };
}) {
  const prompt = `
You are an inbox triage assistant for professionals.

Use ONLY the provided email text and detected signals.
Do NOT invent urgency or facts.
Output:
- suggestedAction: 1 concise sentence with the safest next step.
- draftReply: a short professional reply (3-7 lines). If no reply needed, write "No reply needed."

Guidance:
- If Payment + External Sender: advise verification via known channel before acting.
- If Security: warn about phishing, ask for verification, avoid clicking links.
- If Legal: suggest review, propose edits, request clarification.
- If priority is low: keep draft minimal.

FROM: ${args.from}
SUBJECT: ${args.subject}
PRIORITY: ${args.priority} (${args.priorityScore})
RISK_TAGS: ${JSON.stringify(args.riskTags)}
SIGNALS: ${JSON.stringify(args.signals)}
DEADLINES: ${JSON.stringify(args.extracted.deadlines)}
MONEY: ${JSON.stringify(args.extracted.moneyMentions)}
URLS: ${JSON.stringify(args.extracted.urls)}

EMAIL_RAW:
${args.rawEmail}
`;

  const obj = await generateObject({
    model: openai("gpt-4o-mini"),
    schema: LLMOutSchema,
    prompt,
  });

  return obj.object;
}

// ---------- Connector-ready email getter ----------
async function getEmails(input: { mode: "manual" | "gmail"; emails: string[] }) {
  if (input.mode === "manual") return input.emails;

  // FUTURE: Gmail integration point (keep shape stable)
  return [];
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
  priority: Priority;
  riskTags: string[];
  signals: string[];
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = InboxRequestSchema.parse(body);

    const orgDomains = (parsed.userContext?.orgDomains || []).map((d) => d.toLowerCase());
    const emails = await getEmails({ mode: parsed.mode, emails: parsed.emails });

    // Scan + score deterministically first
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

      const s = scoreEmail(raw, orgDomains);

      return {
        id: `email-${idx + 1}`,
        raw,
        from,
        senderEmail,
        senderDomain,
        subject,
        extracted,
        ...s,
      };
    });

    // Sort by priorityScore desc
    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    // LLM assistance only for top N (keeps it fast + cheaper)
    const TOP_N = Math.min(8, scored.length);

    const alerts: Alert[] = [];

    for (let i = 0; i < TOP_N; i++) {
      const e = scored[i];
      const llm = await llmAssist({
        rawEmail: e.raw,
        from: e.from,
        subject: e.subject,
        priority: e.priority,
        priorityScore: e.priorityScore,
        riskTags: e.riskTags,
        signals: e.signals,
        extracted: e.extracted,
      });

      alerts.push({
        id: e.id,
        from: e.from,
        senderEmail: e.senderEmail || "",
        senderDomain: e.senderDomain || "",
        subject: e.subject,
        priorityScore: e.priorityScore,
        priority: e.priority,
        riskTags: e.riskTags,
        signals: e.signals,
        suggestedAction: llm.suggestedAction,
        draftReply: llm.draftReply,
        extracted: e.extracted,
      });
    }

    // If there are more emails than TOP_N, include remaining without LLM drafts
    for (let i = TOP_N; i < scored.length; i++) {
      const e = scored[i];
      alerts.push({
        id: e.id,
        from: e.from,
        senderEmail: e.senderEmail || "",
        senderDomain: e.senderDomain || "",
        subject: e.subject,
        priorityScore: e.priorityScore,
        priority: e.priority,
        riskTags: e.riskTags,
        signals: e.signals,
        suggestedAction: "No action suggested (not analyzed).",
        draftReply: "No reply needed.",
        extracted: e.extracted,
      });
    }

    const meta = {
      mode: parsed.mode,
      scanned: scored.length,
      highCount: alerts.filter((a) => a.priority === "high").length,
      mediumCount: alerts.filter((a) => a.priority === "medium").length,
      lowCount: alerts.filter((a) => a.priority === "low").length,
    };

    const response = InboxResponseSchema.parse({ ok: true, alerts, meta });
    return Response.json(response);
  } catch (err: any) {
    console.error("Inbox error:", err);
    return Response.json(
      { error: "Inbox scan failed", detail: err?.message || String(err) },
      { status: 500 }
    );
  }
}