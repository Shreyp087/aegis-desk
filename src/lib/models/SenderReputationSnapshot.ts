import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const SenderReputationSnapshotSchema = new Schema(
  {
    senderDomain: { type: String, required: true, trim: true, lowercase: true, maxlength: 180 },
    senderEmailHash: { type: String, default: "", trim: true, maxlength: 128 },
    trustScore: { type: Number, required: true, min: 0, max: 100 },
    reputationScore: { type: Number, required: true, min: 0, max: 100 },
    highCount: { type: Number, default: 0, min: 0 },
    mediumCount: { type: Number, default: 0, min: 0 },
    lowCount: { type: Number, default: 0, min: 0 },
    sampleSize: { type: Number, default: 1, min: 1 },
    notes: { type: [String], default: [] },
    lastSeenAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

SenderReputationSnapshotSchema.index(
  { senderDomain: 1, senderEmailHash: 1, createdAt: -1 },
  { name: "sender_reputation_lookup" }
);
SenderReputationSnapshotSchema.index({ senderDomain: 1, createdAt: -1 });
SenderReputationSnapshotSchema.index({ lastSeenAt: -1 });

export type SenderReputationSnapshotDocument = InferSchemaType<
  typeof SenderReputationSnapshotSchema
> & {
  _id: Types.ObjectId;
};

export const SenderReputationSnapshotModel =
  models.SenderReputationSnapshot ||
  model("SenderReputationSnapshot", SenderReputationSnapshotSchema);

