import { Schema, model, models, type InferSchemaType } from "mongoose";

const AdminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin"], default: "admin", required: true },
    lastLogin: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
    versionKey: false,
  }
);

AdminSchema.index({ createdAt: -1 });

export type AdminDocument = InferSchemaType<typeof AdminSchema> & { _id: string };

export const AdminModel = models.Admin || model("Admin", AdminSchema);
