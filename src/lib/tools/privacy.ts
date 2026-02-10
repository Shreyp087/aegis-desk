export function privacyFirewall(rawQuery: string) {
  const removed: string[] = [];

  let safeQuery = rawQuery;

  // emails
  safeQuery = safeQuery.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    () => {
      removed.push("email");
      return "[REDACTED_EMAIL]";
    }
  );

  // phone-like numbers
  safeQuery = safeQuery.replace(
    /\b(\+?\d{1,2}\s?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    () => {
      removed.push("phone");
      return "[REDACTED_PHONE]";
    }
  );

  // money amounts
  safeQuery = safeQuery.replace(/\$\s?\d+(,\d{3})*(\.\d+)?/g, () => {
    removed.push("amount");
    return "[REDACTED_AMOUNT]";
  });

  // crude “names” placeholder handling (keep it simple for hackathon)
  // In demo: let LLM formulate queries without names, or replace names in prompt itself.

  return { safeQuery, removed };
}