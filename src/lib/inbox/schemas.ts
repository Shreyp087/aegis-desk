import { z } from "zod";

export const InboxMailClassEnum = z.enum([
  "spam",
  "harmful",
  "actionable",
  "informational",
]);

export const InboxThreatTypeEnum = z.enum([
  "phishing",
  "impersonation",
  "malware",
  "payment_fraud",
  "legal_risk",
  "none",
  "unknown",
]);

export const InboxEvidenceRefSchema = z.object({
  type: z.enum(["signal", "category", "reputation", "trust", "thread", "model"]),
  ref: z.string(),
  weight: z.number().min(0).max(1),
});

export const InboxDecisionTraceSchema = z.object({
  policyVersion: z.string(),
  modelVersion: z.string(),
  explanation: z.string(),
  evidenceRefs: z.array(InboxEvidenceRefSchema),
});

export const InboxEntityTypeEnum = z.enum([
  "person",
  "company",
  "organization",
  "unknown",
]);

export type InboxMailClass = z.infer<typeof InboxMailClassEnum>;
export type InboxThreatType = z.infer<typeof InboxThreatTypeEnum>;
export type InboxDecisionTrace = z.infer<typeof InboxDecisionTraceSchema>;
export type InboxEntityType = z.infer<typeof InboxEntityTypeEnum>;
