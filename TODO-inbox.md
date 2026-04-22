# /api/inbox Respan Instrumentation TODO

Status: In Progress

## Breakdown

1. ✅ Add Respan imports to `src/app/api/inbox/route.ts`
2. ✅ Add top-level workflow span for inbox handling (surface: "inbox", workflow_type: "inbox_scan")
3. **[PENDING]** Span classifier calls (`classifyInboxMail`)
4. **[PENDING]** Span llmAssistWithConsensus (multi-model: tool_name="consensus", selected_model list, consensus_strength, disagreement_flags, risk_category from primaryCategory, risk_score from priorityScore, uncertainty_band)
5. **[PENDING]** Span runAssistModel loops (per-model: tool_name=model.provider:model.model)
6. **[PENDING]** Attach metadata (trusted_decision from action, attachment_risk from extracted, historical_trust_used from trustScore>50, redaction_applied=false since no raw in spans)
7. **[PENDING]** Ensure deterministic parts unspanned
8. **[PENDING]** Test: POST /api/inbox manual mode, verify traces

Next: Span llmAssistWithConsensus and models.

Followup: npm run dev, test endpoint, Respan traces show AI parts only.

