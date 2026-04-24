import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDecisionBenchmarkReport,
  runDecisionModelBenchmark,
} from "./decisionModelHarness";

test("decision-model benchmark covers all requested scenarios", () => {
  const { results } = runDecisionModelBenchmark();
  const labels = new Set(results.map((result) => result.label));

  assert.equal(results.length, 18);
  assert.ok(results.some((result) => result.fixtureId === "otp"));
  assert.ok(results.some((result) => result.fixtureId === "temu-promo"));
  assert.ok(results.some((result) => result.fixtureId === "phishing-invoice"));
  assert.ok(results.some((result) => result.fixtureId === "interview-update"));
  assert.ok(
    results.some(
      (result) => result.fixtureId === "trusted-invoice-commerce-family"
    )
  );
  assert.ok(
    results.some(
      (result) => result.fixtureId === "real-password-reset-mixed-promo"
    )
  );
  assert.ok(
    results.some(
      (result) => result.fixtureId === "benign-account-recovery-weak-wording"
    )
  );
  assert.ok(labels.has("OTP"));
  assert.ok(labels.has("Login code"));
  assert.ok(labels.has("Purchase confirmation"));
  assert.ok(labels.has("Shipping update"));
  assert.ok(labels.has("Billing failure"));
  assert.ok(labels.has("Password changed"));
  assert.ok(labels.has("Suspicious login alert"));
  assert.ok(labels.has("Recruiter reply"));
  assert.ok(labels.has("Interview update"));
  assert.ok(labels.has("Temu-style promo"));
  assert.ok(labels.has("Rakuten-style promo"));
  assert.ok(labels.has("Harmless newsletter"));
  assert.ok(labels.has("Phishing lure disguised as invoice"));
  assert.ok(labels.has("Fake password reset"));
  assert.ok(labels.has("Fake order confirmation"));
});

test("decision-model benchmark improves attention quality over the legacy baseline", () => {
  const { metrics } = runDecisionModelBenchmark();

  assert.ok(
    metrics.newModel.attentionRecall > metrics.legacyBaseline.attentionRecall
  );
  assert.ok(
    metrics.newModel.falsePositiveRateOnImportantBenignMail <
      metrics.legacyBaseline.falsePositiveRateOnImportantBenignMail
  );
  assert.ok(metrics.newModel.promoSuppressionPrecision >= 90);
  assert.ok(metrics.newModel.authenticationEventRecall >= 90);
  assert.ok(metrics.newModel.transactionalEventRecall >= 90);
  assert.ok(metrics.newModel.jobUpdateRecall >= 90);
  assert.ok(metrics.newModel.explanationCapsuleCoverage === 100);
});

test("benchmark report is readable and includes scenario outcomes", () => {
  const { metrics, results } = runDecisionModelBenchmark();
  const report = formatDecisionBenchmarkReport(metrics, results);

  assert.match(report, /Aegis Decision Model Benchmark/);
  assert.match(report, /Attention precision/);
  assert.match(report, /OTP/);
  assert.match(report, /Temu-style promo/);
  assert.match(report, /Rakuten-style promo/);
  assert.match(report, /Interview update/);
  assert.match(report, /Phishing lure disguised as invoice/);
  assert.match(report, /Trusted invoice from commerce sender family/);
  assert.match(report, /Real password reset mixed with promo language/);
  assert.match(report, /Benign account recovery notice with weak wording/);
  assert.match(report, /Explanation\/capsule coverage/);
  assert.match(report, /Uncertainty-triggered human review rate/);
});
