import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["user"], default: "user", required: true },
    lastLogin: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
    versionKey: false,
  }
);

UserSchema.index({ createdAt: -1 });

export type UserDocument = InferSchemaType<typeof UserSchema> & { _id: string };

export const UserModel = models.User || model("User", UserSchema);
