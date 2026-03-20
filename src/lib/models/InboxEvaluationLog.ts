import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const GroundTruthSchema = new Schema(
  {
    label: { type: String, default: "", trim: true, maxlength: 80 },
    action: { type: String, default: "", trim: true, maxlength: 80 },
    source: { type: String, default: "", trim: true, maxlength: 120 },
    recordedAt: { type: String, default: "", trim: true, maxlength: 80 },
  },
  { _id: false }
);

const InboxEvaluationLogSchema = new Schema(
  {
    loggedAt: { type: Date, required: true, index: true },
    messageId: { type: String, required: true, trim: true, maxlength: 180 },
    prediction: { type: String, required: true, trim: true, maxlength: 80 },
    rawPrediction: { type: String, default: "", trim: true, maxlength: 80 },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    rawModelConfidence: { type: Number, default: 0, min: 0, max: 1 },
    uncertainty: { type: Number, required: true, min: 0, max: 1 },
    uncertaintyPercent: { type: Number, default: 0, min: 0, max: 100 },
    action: { type: String, required: true, trim: true, maxlength: 80 },
    routingAction: { type: String, default: "", trim: true, maxlength: 80 },
    consensusMode: { type: String, enum: ["single", "multi"], default: "single" },
    consensusSource: { type: String, enum: ["env_default", "admin_override"], default: "env_default" },
    consensusMaxModels: { type: Number, default: 1, min: 1, max: 8 },
    consensusModels: { type: [String], default: [] },
    consensusStrength: { type: Number, default: 0, min: 0, max: 1 },
    disagreementFlags: { type: [String], default: [] },
    sourceMode: { type: String, enum: ["manual", "gmail"], default: "manual" },
    processingMode: {
      type: String,
      enum: ["offline_enforced", "hybrid_remote_llm"],
      default: "hybrid_remote_llm",
    },
    modelVersion: { type: String, default: "", trim: true, maxlength: 120 },
    classifierVersion: { type: String, default: "", trim: true, maxlength: 120 },
    policyVersion: { type: String, default: "", trim: true, maxlength: 120 },
    groundTruth: { type: GroundTruthSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

InboxEvaluationLogSchema.index({ messageId: 1, loggedAt: -1 });
InboxEvaluationLogSchema.index({ prediction: 1, loggedAt: -1 });
InboxEvaluationLogSchema.index({ action: 1, loggedAt: -1 });
InboxEvaluationLogSchema.index({ sourceMode: 1, loggedAt: -1 });
InboxEvaluationLogSchema.index({ "groundTruth.label": 1, loggedAt: -1 });

export type InboxEvaluationLogDocument = InferSchemaType<typeof InboxEvaluationLogSchema> & {
  _id: Types.ObjectId;
};

export const InboxEvaluationLogModel =
  models.InboxEvaluationLog || model("InboxEvaluationLog", InboxEvaluationLogSchema);
