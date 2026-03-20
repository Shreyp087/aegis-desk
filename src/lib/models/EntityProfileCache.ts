import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const EntityProfileCacheSchema = new Schema(
  {
    cacheKey: { type: String, required: true, unique: true, trim: true, maxlength: 200 },
    entity: { type: String, required: true, trim: true, maxlength: 180 },
    entityType: { type: String, default: "unknown", trim: true, maxlength: 40 },
    query: { type: String, required: true, trim: true, maxlength: 400 },
    depth: { type: String, required: true, enum: ["standard", "deep"] },
    profile: { type: Schema.Types.Mixed, required: true },
    confidence: { type: Number, default: 0, min: 0, max: 100 },
    sourceUrls: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
    lastAccessedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

EntityProfileCacheSchema.index({ entity: 1, createdAt: -1 });
EntityProfileCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
EntityProfileCacheSchema.index({ lastAccessedAt: -1 });

export type EntityProfileCacheDocument = InferSchemaType<typeof EntityProfileCacheSchema> & {
  _id: Types.ObjectId;
};

export const EntityProfileCacheModel =
  models.EntityProfileCache || model("EntityProfileCache", EntityProfileCacheSchema);
