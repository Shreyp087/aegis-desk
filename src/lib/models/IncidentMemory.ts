import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const TopCategoryScoreSchema = new Schema(
  {
    category: { type: String, required: true, trim: true, maxlength: 80 },
    score: { type: Number, required: true, min: 0, max: 100 },
    reason: { type: String, required: true, trim: true, maxlength: 240 },
  },
  { _id: false }
);

const ThreadSnapshotSchema = new Schema(
  {
    depth: { type: Number, required: true, min: 1 },
    riskDensity: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const ExtractedCountsSchema = new Schema(
  {
    deadlines: { type: Number, required: true, min: 0 },
    moneyMentions: { type: Number, required: true, min: 0 },
    urls: { type: Number, required: true, min: 0 },
    attachments: { type: Number, required: true, min: 0 },
    attachmentRiskScore: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const GuardrailSnapshotSchema = new Schema(
  {
    ruleHits: { type: [String], default: [] },
    rationale: { type: String, required: true, trim: true, maxlength: 400 },
  },
  { _id: false }
);

const ProbabilitySchema = new Schema(
  {
    spam: { type: Number, required: true, min: 0, max: 1 },
    harmful: { type: Number, required: true, min: 0, max: 1 },
    actionable: { type: Number, required: true, min: 0, max: 1 },
    informational: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const AgreementScoresSchema = new Schema(
  {
    label_agreement: { type: Number, required: true, min: 0, max: 1 },
    action_agreement: { type: Number, required: true, min: 0, max: 1 },
    confidence_variance: { type: Number, required: true, min: 0, max: 1 },
    entity_overlap: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const DeterministicSignalsSchema = new Schema(
  {
    topCategoryScores: { type: [TopCategoryScoreSchema], default: [] },
    riskTags: { type: [String], default: [] },
    signals: { type: [String], default: [] },
    trustScore: { type: Number, required: true, min: 0, max: 100 },
    reputationScore: { type: Number, required: true, min: 0, max: 100 },
    reputationFindings: { type: [String], default: [] },
    thread: { type: ThreadSnapshotSchema, required: true },
    extractedCounts: { type: ExtractedCountsSchema, required: true },
    guardrails: { type: GuardrailSnapshotSchema, required: true },
  },
  { _id: false }
);

const LearnedSignalsSchema = new Schema(
  {
    classifier: {
      type: new Schema(
        {
          modelVersion: { type: String, required: true, trim: true, maxlength: 80 },
          predictedClass: { type: String, required: true, trim: true, maxlength: 40 },
          probabilities: { type: ProbabilitySchema, required: true },
          memorySampleCount: { type: Number, required: true, min: 0 },
          rationale: { type: String, required: true, trim: true, maxlength: 400 },
        },
        { _id: false }
      ),
      required: true,
    },
    consensus: {
      type: new Schema(
        {
          score: { type: Number, required: true, min: 0, max: 100 },
          note: { type: String, required: true, trim: true, maxlength: 400 },
          strength: { type: Number, required: true, min: 0, max: 1 },
          agreementScores: { type: AgreementScoresSchema, required: true },
          disagreementFlags: { type: [String], default: [] },
        },
        { _id: false }
      ),
      required: true,
    },
  },
  { _id: false }
);

const IncidentMemorySchema = new Schema(
  {
    sourceEmailId: { type: String, required: true, trim: true, maxlength: 140 },
    sourceHash: { type: String, required: true, trim: true, maxlength: 128 },
    senderDomain: { type: String, default: "", trim: true, lowercase: true, maxlength: 180 },
    senderEmailHash: { type: String, default: "", trim: true, maxlength: 128 },
    subjectHash: { type: String, default: "", trim: true, maxlength: 128 },

    primaryCategory: { type: String, required: true, trim: true, maxlength: 80 },
    mailClass: { type: String, required: true, trim: true, maxlength: 40 },
    threatType: { type: String, required: true, trim: true, maxlength: 40 },
    trustedAction: { type: String, required: true, trim: true, maxlength: 32 },
    priorityScore: { type: Number, required: true, min: 0, max: 100 },
    consensusScore: { type: Number, required: true, min: 0, max: 100 },

    riskTags: { type: [String], default: [] },
    signals: { type: [String], default: [] },
    uncertaintyScore: { type: Number, min: 0, max: 1, default: undefined },
    uncertaintyTypes: { type: [String], default: [] },
    uncertaintySources: {
      type: new Schema(
        {
          modelConfidence: { type: Number, required: true, min: 0, max: 1 },
          signalConflict: { type: Number, required: true, min: 0, max: 1 },
          missingFields: { type: Number, required: true, min: 0 },
        },
        { _id: false }
      ),
      default: undefined,
    },
    deterministicSignals: { type: DeterministicSignalsSchema, default: undefined },
    learnedSignals: { type: LearnedSignalsSchema, default: undefined },
    explanationSummary: { type: String, default: "", trim: true, maxlength: 500 },
    explanationKeyFactors: { type: [String], default: [] },
    evidenceRefs: {
      type: [
        {
          type: { type: String, required: true, trim: true, maxlength: 24 },
          ref: { type: String, required: true, trim: true, maxlength: 200 },
          weight: { type: Number, required: true, min: 0, max: 1 },
        },
      ],
      default: [],
    },

    policyVersion: { type: String, required: true, trim: true, maxlength: 80 },
    modelVersion: { type: String, required: true, trim: true, maxlength: 80 },

    outcomeLabel: { type: String, default: "", trim: true, maxlength: 80 },
    feedbackSource: { type: String, default: "", trim: true, maxlength: 60 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

IncidentMemorySchema.index({ createdAt: -1 });
IncidentMemorySchema.index({ senderDomain: 1, createdAt: -1 });
IncidentMemorySchema.index({ mailClass: 1, threatType: 1, createdAt: -1 });
IncidentMemorySchema.index({ sourceHash: 1, createdAt: -1 });
IncidentMemorySchema.index({ outcomeLabel: 1, createdAt: -1 });

export type IncidentMemoryDocument = InferSchemaType<typeof IncidentMemorySchema> & {
  _id: Types.ObjectId;
};

export const IncidentMemoryModel =
  models.IncidentMemory || model("IncidentMemory", IncidentMemorySchema);
