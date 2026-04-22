# /api/run Instrumentation TODO

Status: In Progress

## Breakdown of Approved Plan

1. ✅ Add Respan imports to `src/app/api/run/route.ts`
2. ✅ Wrap entire POST handler body in top-level `withAegisWorkflowSpan`
3. ✅ Add span for `request_validation` (schema + offline check)
4. **[PENDING]** Add span for `privacy_redaction` (loop per step)
5. **[PENDING]** Add span for `web_research` (Linkup search loop)
6. **[PENDING]** Add span for `evidence_collection` (summarize + group)
7. **[PENDING]** Add span for `entity_profiling` (cache + LLM profile loop)
8. **[PENDING]** Add span for `ics_generation` (conditional)
9. **[PENDING]** Add span for `synthesis` (final LLM + parse)
10. **[PENDING]** Add span for `final_packaging` (formatFinalOutput)
11. **[PENDING]** Test: Run /api/run POST, verify traces + unchanged output

Next: Execute step 1 (imports + top-level span).

## Followup After Completion
- Verify traces in Respan dashboard
- `npm run dev` + endpoint test
- Update TODO as steps complete
- `attempt_completion`

