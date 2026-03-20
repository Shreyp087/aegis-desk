import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const RiskSummarySchema = new Schema(
  {
    category: { type: String, required: true, trim: true, maxlength: 80 },
    score: { type: Number, required: true, min: 0, max: 100 },
    deterministicNotes: { type: [String], default: [] },
    llmSummary: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const TicketAdminMetaSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["new", "triaged", "in_progress", "resolved", "closed"],
      default: "new",
      required: true,
    },
    assignee: { type: String, default: "", trim: true, maxlength: 180 },
    notes: { type: String, default: "", trim: true, maxlength: 4000 },
    updatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const LocalTicketRecordSchema = new Schema(
  {
    localTicketId: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
    peppermintTicketId: { type: String, default: null, trim: true, maxlength: 120 },
    sourceEmailId: { type: String, required: true, unique: true, trim: true, maxlength: 180 },
    channel: { type: String, enum: ["inbox", "user_dashboard"], default: "inbox" },
    sender: { type: String, default: "", trim: true, maxlength: 220 },
    requesterName: { type: String, default: "", trim: true, maxlength: 180 },
    subject: { type: String, default: "", trim: true, maxlength: 500 },
    details: { type: String, default: "", trim: true, maxlength: 12000 },
    date: { type: String, default: "", trim: true, maxlength: 80 },
    risk: { type: RiskSummarySchema, required: true },
    decision: { type: String, enum: ["escalate", "quarantine"], required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    syncState: { type: String, enum: ["local_only", "pending", "synced", "failed"], required: true },
    lastSyncAttemptAt: { type: Date, default: null },
    lastSyncError: { type: String, default: "", trim: true, maxlength: 2000 },
    admin: { type: TicketAdminMetaSchema, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

LocalTicketRecordSchema.index({ sourceEmailId: 1 }, { unique: true });
LocalTicketRecordSchema.index({ syncState: 1, createdAt: -1 });
LocalTicketRecordSchema.index({ "admin.status": 1, updatedAt: -1 });
LocalTicketRecordSchema.index({ createdAt: -1 });

export type LocalTicketRecordDocument = InferSchemaType<typeof LocalTicketRecordSchema> & {
  _id: Types.ObjectId;
};

export const LocalTicketRecordModel =
  models.LocalTicketRecord || model("LocalTicketRecord", LocalTicketRecordSchema);
