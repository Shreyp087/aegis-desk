import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

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

