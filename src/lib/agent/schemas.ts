import { z } from "zod";

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  needsWeb: z.boolean(),
  webReason: z.string().optional(),
  tools: z.array(z.enum(["privacyFirewall", "linkupSearch", "createICS"])),
});

export const PlanSchema = z.object({
  goal: z.string(),
  contextSummary: z.string(),
  steps: z.array(PlanStepSchema).min(3),
});

export type Plan = z.infer<typeof PlanSchema>;

export const AgentFinalSchema = z.object({
  replyDraft: z.string(),
  verifiedClaims: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum(["verified", "refuted", "uncertain"]),
      evidence: z.string(),
      sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
    })
  ),
  meeting: z.object({
    title: z.string(),
    datetimeISO: z.string(),
    ics: z.string(),
  }),
  notes: z.object({
    uncertainties: z.array(z.string()),
    whatIDid: z.array(z.string()),
  }),
});

export type AgentFinal = z.infer<typeof AgentFinalSchema>;
