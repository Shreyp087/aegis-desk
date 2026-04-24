type AlertWithRawEmail = {
  rawEmail?: string;
  rawEmailAvailable?: boolean;
};

export type CachedBrowserSessionAlert<T extends AlertWithRawEmail> = Omit<T, "rawEmail"> & {
  rawEmailAvailable: boolean;
};

/**
 * Returns whether an alert currently carries raw email content in memory.
 *
 * Pipeline step: browser-session cache sanitization.
 * False-positive scenario addressed: distinguishes live in-memory alerts from restored alerts whose raw email was intentionally stripped before persistence.
 */
function hasRawEmailContent(rawEmail?: string): boolean {
  return typeof rawEmail === "string" && rawEmail.trim().length > 0;
}

/**
 * Removes raw email content before persisting scanner state to browser session storage.
 *
 * Pipeline step: browser-session persistence.
 * False-positive scenario addressed: prevents the browser cache from quietly becoming a second persistence layer for full message bodies.
 */
export function sanitizeAlertsForBrowserSession<T extends { rawEmail: string }>(
  alerts: readonly T[]
): Array<CachedBrowserSessionAlert<T>> {
  return alerts.map(({ rawEmail, ...alert }) => ({
    ...alert,
    rawEmailAvailable: hasRawEmailContent(rawEmail),
  }));
}

/**
 * Restores cached alerts into the live scanner shape, preserving legacy cached raw email when present.
 *
 * Pipeline step: browser-session hydration.
 * False-positive scenario addressed: keeps older cached sessions readable while ensuring newly sanitized sessions do not pretend to have raw email available after refresh.
 */
export function restoreAlertsFromBrowserSession<T extends AlertWithRawEmail>(
  alerts: readonly T[]
): Array<Omit<T, "rawEmail" | "rawEmailAvailable"> & { rawEmail: string; rawEmailAvailable: boolean }> {
  return alerts.map((alert) => {
    const rawEmailAvailable = hasRawEmailContent(alert.rawEmail);
    const { rawEmail: _rawEmail, rawEmailAvailable: _ignoredFlag, ...rest } = alert;
    void _rawEmail;
    void _ignoredFlag;

    return {
      ...rest,
      rawEmail: rawEmailAvailable ? alert.rawEmail ?? "" : "",
      rawEmailAvailable,
    };
  });
}
