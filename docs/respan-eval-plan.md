# Respan Integration Eval Plan

## Metadata Normalization Status
All spans use `AegisRespanMetadataInput`:
- service: "aegis-desk"
- surface: route-specific ("agent", "inbox", "plan")
- workflow_type: specific ("run", "inbox_scan", "plan")
- endpoint: "/api/..."
- risk_category: primaryCategory mapped
- risk_score: priorityScore / 100
- uncertainty_band: low/medium/high from uncertaintyPercent
- trusted_decision: action boolean
- tool_name, selected_model consistent

## Future Evaluator Dimensions
1. **Action Alignment**: trusted_decision vs observed routing
2. **Draft Safety**: replyDraft constraints (no action, verify first, etc)
3. **Evidence Grounding**: proof items match Linkup evidence
4. **Schema Compliance**: JSON validation success
5. **Escalation Appropriateness**: should_escalate flag vs decision
6. **Uncertainty Calibration**: uncertaintyPercent vs outcome

## Fixtures
See `test-support/respan-eval-fixtures.json` for 5 golden test cases.

## Usage
curl localhost:3000/api/run -d '@fixtures/clear_phishing.json'
