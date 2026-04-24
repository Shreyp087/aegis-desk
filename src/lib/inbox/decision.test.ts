import assert from "node:assert/strict";
import test from "node:test";

import { routeInboxDecision } from "./decision";

test("safe but important mail can auto-triage for direct surfacing", () => {
  const decision = routeInboxDecision({
    confidencePct: 74,
    uncertaintyPercent: 24,
    riskScore: 22,
    attentionPriorityLevel: "urgent",
    securitySeverityLevel: "benign",
    trustedAction: "allow",
    disagreementFlags: [],
  });

  assert.equal(decision.final_action, "auto_triage");
  assert.equal(decision.risk_level, "low");
  assert.match(decision.reason, /important to the user/i);
});

test("review-worthy suspicious account alerts can surface without forced escalation", () => {
  const decision = routeInboxDecision({
    confidencePct: 78,
    uncertaintyPercent: 30,
    riskScore: 46,
    attentionPriorityLevel: "high",
    securitySeverityLevel: "suspicious",
    trustedAction: "allow",
    disagreementFlags: [],
  });

  assert.equal(decision.final_action, "auto_triage");
  assert.equal(decision.risk_level, "medium");
  assert.match(decision.reason, /suspicious but personally relevant/i);
});

test("contained dangerous mail does not force extra user review by default", () => {
  const decision = routeInboxDecision({
    confidencePct: 90,
    uncertaintyPercent: 18,
    riskScore: 90,
    attentionPriorityLevel: "low",
    securitySeverityLevel: "critical",
    trustedAction: "quarantine",
    disagreementFlags: [],
  });

  assert.equal(decision.final_action, "auto_triage");
  assert.equal(decision.risk_level, "high");
  assert.match(decision.reason, /already being QUARANTINED/i);
});

test("hard disagreement still forces human review even when axes look surfaceable", () => {
  const decision = routeInboxDecision({
    confidencePct: 86,
    uncertaintyPercent: 20,
    riskScore: 24,
    attentionPriorityLevel: "high",
    securitySeverityLevel: "benign",
    trustedAction: "allow",
    disagreementFlags: ["label_disagreement"],
  });

  assert.equal(decision.final_action, "human_review");
  assert.equal(decision.risk_level, "low");
});
