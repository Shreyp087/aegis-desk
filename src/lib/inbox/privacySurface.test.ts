import assert from "node:assert/strict";
import test from "node:test";

import { buildInboxTrustSurface } from "./privacySurface";

test("privacy surface describes the local-first storage map with derived server persistence", () => {
  const surface = buildInboxTrustSurface({
    processingMode: "offline_enforced",
    mongoConfigured: true,
  });

  assert.equal(surface.localFirst, true);
  assert.equal(surface.deterministicCriticalPath, true);
  assert.equal(surface.summary.requestScopedRawEmailHandling, true);
  assert.equal(surface.summary.httpOnlyTrustCookie, true);
  assert.equal(surface.summary.serverSideDerivedMemoryOnly, true);
  assert.equal(surface.summary.browserSessionStoresRawEmail, false);
  assert.equal(surface.summary.optionalRemoteModelProcessing, false);
  assert.equal(surface.summary.evaluationLogStore, "mongo");

  const sessionStoreLayer = surface.layers.find(
    (layer) => layer.id === "session_store"
  );
  assert.ok(sessionStoreLayer);
  assert.equal(sessionStoreLayer.containsRawEmailContent, false);
  assert.ok(sessionStoreLayer.dataForm.includes("hashed identifiers"));

  const browserCacheLayer = surface.layers.find(
    (layer) => layer.id === "browser_session_cache"
  );
  assert.ok(browserCacheLayer);
  assert.equal(browserCacheLayer.containsRawEmailContent, false);
  assert.ok(browserCacheLayer.storedFields.includes("rawEmailAvailable"));

  const trustCookieLayer = surface.layers.find(
    (layer) => layer.id === "trust_graph_cookie"
  );
  assert.ok(trustCookieLayer);
  assert.match(trustCookieLayer.retention, /120 days/i);

  const incidentMemoryLayer = surface.layers.find(
    (layer) => layer.id === "incident_memory"
  );
  assert.ok(incidentMemoryLayer);
  assert.equal(incidentMemoryLayer.enabled, true);
  assert.equal(incidentMemoryLayer.containsRawEmailContent, false);
});

test("privacy surface reflects sanitized browser caching and optional remote processing honestly", () => {
  const surface = buildInboxTrustSurface({
    processingMode: "hybrid_remote_llm",
    mongoConfigured: false,
  });

  assert.equal(surface.summary.optionalRemoteModelProcessing, true);
  assert.equal(surface.summary.evaluationLogStore, "jsonl");

  assert.ok(
    surface.flags.some((flag) => flag.id === "browser_session_cache_sanitized")
  );
  assert.ok(
    surface.flags.some((flag) => flag.id === "api_raw_email_exposure")
  );
  assert.ok(
    surface.flags.some((flag) => flag.id === "optional_remote_model_transfer")
  );

  const evaluationLayer = surface.layers.find(
    (layer) => layer.id === "evaluation_logs"
  );
  assert.ok(evaluationLayer);
  assert.match(evaluationLayer.location, /scanner\.evaluation\.jsonl/i);

  const modelLayer = surface.layers.find(
    (layer) => layer.id === "optional_model_outputs"
  );
  assert.ok(modelLayer);
  assert.equal(modelLayer.containsRawEmailContent, true);
});
