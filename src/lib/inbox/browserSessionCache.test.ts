import assert from "node:assert/strict";
import test from "node:test";

import {
  restoreAlertsFromBrowserSession,
  sanitizeAlertsForBrowserSession,
} from "./browserSessionCache";

test("sanitizeAlertsForBrowserSession strips raw email while keeping availability state", () => {
  const sanitized = sanitizeAlertsForBrowserSession([
    {
      id: "live-1",
      subject: "Your verification code",
      rawEmail: "From: Example\n\nCode: 123456",
    },
  ]);

  assert.deepEqual(sanitized, [
    {
      id: "live-1",
      subject: "Your verification code",
      rawEmailAvailable: true,
    },
  ]);
});

test("restoreAlertsFromBrowserSession marks sanitized alerts as unavailable", () => {
  const restored = restoreAlertsFromBrowserSession([
    {
      id: "cached-1",
      subject: "Receipt",
      rawEmailAvailable: true,
    },
  ]);

  assert.deepEqual(restored, [
    {
      id: "cached-1",
      subject: "Receipt",
      rawEmail: "",
      rawEmailAvailable: false,
    },
  ]);
});

test("restoreAlertsFromBrowserSession preserves legacy cached raw email payloads", () => {
  const restored = restoreAlertsFromBrowserSession([
    {
      id: "legacy-1",
      subject: "Account alert",
      rawEmail: "From: Example\n\nWe noticed a new sign-in.",
      rawEmailAvailable: true,
    },
  ]);

  assert.deepEqual(restored, [
    {
      id: "legacy-1",
      subject: "Account alert",
      rawEmail: "From: Example\n\nWe noticed a new sign-in.",
      rawEmailAvailable: true,
    },
  ]);
});
