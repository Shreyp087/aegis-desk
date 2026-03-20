import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const FrictionBudgetSchema = new Schema(
  {
    cap: { type: Number, required: true, min: 0 },
    used: { type: Number, required: true, min: 0 },
    remaining: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const QueueGuardLedgerSchema = new Schema(
  {
    ledgerId: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    ts: { type: String, required: true, trim: true, maxlength: 80, index: true },
    sessionId: { type: String, required: true, trim: true, maxlength: 128, index: true },
    eventKind: { type: String, enum: ["score", "verify"], required: true },
    eventType: { type: String, enum: ["join_queue", "checkout", "refresh"], required: true },
    attemptedAction: { type: String, enum: ["join_queue", "checkout", "refresh"], required: true },
    decisionAction: { type: String, enum: ["ALLOW", "STEP_UP", "THROTTLE", "BLOCK"], required: true, index: true },
    risk: { type: Number, required: true, min: 0, max: 100 },
    topFactorKeys: { type: [String], default: [] },
    stepUpLevel: { type: Number, enum: [0, 1, 2], required: true },
    stepUpOutcome: { type: String, enum: ["none", "issued", "pass", "fail"], required: true },
    policyVersion: { type: String, required: true, trim: true, maxlength: 120 },
    frictionBudget: { type: FrictionBudgetSchema, required: true },
    latencyMs: { type: Number, required: true, min: 0 },
    prevHash: { type: String, required: true, trim: true, maxlength: 256 },
    entryHash: { type: String, required: true, trim: true, maxlength: 256, index: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

QueueGuardLedgerSchema.index({ ts: -1 });
QueueGuardLedgerSchema.index({ sessionId: 1, ts: -1 });
QueueGuardLedgerSchema.index({ decisionAction: 1, ts: -1 });

export type QueueGuardLedgerDocument = InferSchemaType<typeof QueueGuardLedgerSchema> & {
  _id: Types.ObjectId;
};

export const QueueGuardLedgerModel =
  models.QueueGuardLedger || model("QueueGuardLedger", QueueGuardLedgerSchema);
