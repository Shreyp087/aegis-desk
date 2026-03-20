import { z } from "zod";

export const ClaimTypeEnum = z.enum([
  "sender_identity",
  "organization",
  "financial_request",
  "urgency",
]);

export const ExtractedClaimSchema = z.object({
  text: z.string(),
  type: ClaimTypeEnum,
  confidence: z.number().min(0).max(1),
});

export const ClaimVerificationSchema = z.object({
  status: z.literal("unverified"),
  notes: z.string(),
});

export const VerifiedClaimSchema = ExtractedClaimSchema.extend({
  verification: ClaimVerificationSchema,
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;
export type ClaimVerification = z.infer<typeof ClaimVerificationSchema>;
export type VerifiedClaim = z.infer<typeof VerifiedClaimSchema>;

type ClaimVerificationContext = {
  emailText: string;
  docText: string;
};

function extractHeader(raw: string, key: string): string {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "im");
  return raw.match(regex)?.[1]?.trim() || "";
}

function senderEmailFromFromHeader(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.toLowerCase() || "";
}

function senderNameFromFromHeader(value: string): string {
  const withoutAngle = value.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  return withoutAngle;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractClaimAnchor(value: string): string {
  const cleaned = value
    .replace(/\b(inc|corp|corporation|llc|ltd|limited|plc|gmbh|company|organization|org)\b/gi, "")
    .trim();
  const tokens = normalizeText(cleaned)
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  return compactToken(tokens[0] || cleaned);
}

function defaultVerification(notes = "No external verification run yet. Claim retained as unverified."): ClaimVerification {
  return {
    status: "unverified",
    notes,
  };
}

function verifySenderIdentityClaim(
  claim: ExtractedClaim,
  context: ClaimVerificationContext
): ClaimVerification {
  const fromHeader = extractHeader(context.emailText, "From");
  const senderEmail = senderEmailFromFromHeader(fromHeader);
  const senderDomain = senderEmail.split("@")[1] || "";
  const senderName = senderNameFromFromHeader(fromHeader);
  const claimNorm = normalizeText(claim.text);
  const senderNameNorm = normalizeText(senderName);
  const anchor = extractClaimAnchor(claim.text);

  if (senderNameNorm && claimNorm.includes(senderNameNorm)) {
    return defaultVerification(
      `Sender identity claim matches the From header name "${senderName}". No external verification has been run yet.`
    );
  }

  if (senderDomain && anchor && !senderDomain.includes(anchor)) {
    return defaultVerification(
      `Potential domain mismatch: claim references "${claim.text}" while sender domain is "${senderDomain}". No external verification has been run yet.`
    );
  }

  if (senderEmail) {
    return defaultVerification(
      `Sender header "${senderEmail}" was available for heuristic comparison, but the claim remains unverified without external evidence.`
    );
  }

  return defaultVerification();
}

function verifyOrganizationClaim(
  claim: ExtractedClaim,
  context: ClaimVerificationContext
): ClaimVerification {
  const fromHeader = extractHeader(context.emailText, "From");
  const senderEmail = senderEmailFromFromHeader(fromHeader);
  const senderDomain = senderEmail.split("@")[1] || "";
  const anchor = extractClaimAnchor(claim.text);

  if (senderDomain && anchor && !senderDomain.includes(anchor)) {
    return defaultVerification(
      `Potential organization/domain mismatch: claim references "${claim.text}" while sender domain is "${senderDomain}". No external verification has been run yet.`
    );
  }

  if (senderDomain) {
    return defaultVerification(
      `Organization claim was heuristically compared with sender domain "${senderDomain}", but remains unverified without external evidence.`
    );
  }

  return defaultVerification();
}

function verifyFinancialRequestClaim(
  claim: ExtractedClaim,
  context: ClaimVerificationContext
): ClaimVerification {
  const text = `${context.emailText}\n${context.docText}`.toLowerCase();
  const hasFinancialLanguage =
    /\b(invoice|payment|wire|ach|bank details|beneficiary|refund|billing|remittance)\b/.test(text);

  if (hasFinancialLanguage) {
    return defaultVerification(
      `Financial-request language is present in the local context for "${claim.text}", but no external verification has been run yet.`
    );
  }

  return defaultVerification(
    `Claim "${claim.text}" is marked as a financial request, but only lightweight local heuristics were applied.`
  );
}

function verifyUrgencyClaim(
  claim: ExtractedClaim,
  context: ClaimVerificationContext
): ClaimVerification {
  const text = `${context.emailText}\n${context.docText}`.toLowerCase();
  const hasUrgencyLanguage =
    /\b(urgent|immediately|asap|today|by end of day|eod|deadline|time-sensitive|right away)\b/.test(
      text
    );

  if (hasUrgencyLanguage) {
    return defaultVerification(
      `Urgency framing is present in the local context for "${claim.text}", but the claim remains unverified without external validation.`
    );
  }

  return defaultVerification(
    `Urgency claim "${claim.text}" was retained, but only lightweight local heuristics were applied.`
  );
}

export function verifyClaim(
  claim: ExtractedClaim,
  context: ClaimVerificationContext
): ClaimVerification {
  try {
    if (claim.type === "sender_identity") {
      return verifySenderIdentityClaim(claim, context);
    }
    if (claim.type === "organization") {
      return verifyOrganizationClaim(claim, context);
    }
    if (claim.type === "financial_request") {
      return verifyFinancialRequestClaim(claim, context);
    }
    if (claim.type === "urgency") {
      return verifyUrgencyClaim(claim, context);
    }
    return defaultVerification();
  } catch {
    return defaultVerification(
      `Claim verification heuristics failed for "${claim.text}". Claim left unverified.`
    );
  }
}

export function attachClaimVerification(
  claims: ExtractedClaim[],
  context: ClaimVerificationContext
): VerifiedClaim[] {
  return claims.map((claim) => ({
    ...claim,
    verification: verifyClaim(claim, context),
  }));
}
