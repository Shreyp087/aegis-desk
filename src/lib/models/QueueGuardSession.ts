import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const RiskFactorSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    weight: { type: Number, required: true, min: 0, max: 100 },
    score: { type: Number, required: true, min: 0, max: 1 },
    contribution: { type: Number, required: true, min: 0, max: 100 },
    evidence: { type: String, required: true, trim: true, maxlength: 400 },
  },
  { _id: false }
);

const FrictionBudgetSchema = new Schema(
  {
    cap: { type: Number, required: true, min: 0 },
    used: { type: Number, required: true, min: 0 },
    remaining: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const QueueDecisionSchema = new Schema(
  {
    risk: { type: Number, required: true, min: 0, max: 100 },
    factors: { type: [RiskFactorSchema], default: [] },
    topFactors: { type: [RiskFactorSchema], default: [] },
    action: { type: String, enum: ["ALLOW", "STEP_UP", "THROTTLE", "BLOCK"], required: true },
    stepUpLevel: { type: Number, enum: [0, 1, 2], required: true },
    frictionBudget: { type: FrictionBudgetSchema, required: true },
    policyVersion: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const PendingChallengeSchema = new Schema(
  {
    challengeId: { type: String, required: true, trim: true, maxlength: 120 },
    level: { type: Number, enum: [0, 1, 2], required: true },
    kind: { type: String, enum: ["hold", "otp"], required: true },
    issuedAt: { type: Number, required: true, min: 0 },
    expiresAt: { type: Number, default: undefined, min: 0 },
    otpCode: { type: String, default: undefined, trim: true, maxlength: 12 },
  },
  { _id: false }
);

const SessionHistoryEntrySchema = new Schema(
  {
    ts: { type: Number, required: true, min: 0 },
    eventType: { type: String, enum: ["join_queue", "checkout", "refresh"], required: true },
    payloadHash: { type: String, required: true, trim: true, maxlength: 256 },
    sequenceFingerprint: { type: String, required: true, trim: true, maxlength: 256 },
  },
  { _id: false }
);

const QueueGuardSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, trim: true, maxlength: 128 },
    createdAtMs: { type: Number, required: true, min: 0 },
    lastSeenAtMs: { type: Number, required: true, min: 0, index: true },
    trustedUntilMs: { type: Number, default: undefined, min: 0 },
    frictionUsed: { type: Number, required: true, min: 0 },
    challengeAttempts: { type: Number, required: true, min: 0 },
    challengePasses: { type: Number, required: true, min: 0 },
    challengeFailures: { type: Number, required: true, min: 0 },
    pendingChallenge: { type: PendingChallengeSchema, default: undefined },
    lastDecision: { type: QueueDecisionSchema, default: undefined },
    lastEventType: { type: String, enum: ["join_queue", "checkout", "refresh"], default: undefined },
    history: { type: [SessionHistoryEntrySchema], default: [] },
    payloadCounts: { type: Map, of: Number, default: {} },
    sequenceCounts: { type: Map, of: Number, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

QueueGuardSessionSchema.index({ sessionId: 1 }, { unique: true });
QueueGuardSessionSchema.index({ lastSeenAtMs: -1 });

export type QueueGuardSessionDocument = InferSchemaType<typeof QueueGuardSessionSchema> & {
  _id: Types.ObjectId;
};

export const QueueGuardSessionModel =
  models.QueueGuardSession || model("QueueGuardSession", QueueGuardSessionSchema);
