import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const TicketAuditEventSchema = new Schema(
  {
    type: { type: String, required: true, trim: true, maxlength: 80 },
    at: { type: Date, required: true, index: true },
    localTicketId: { type: String, required: true, trim: true, maxlength: 120, index: true },
    sourceEmailId: { type: String, default: "", trim: true, maxlength: 180 },
    decision: { type: String, default: "", trim: true, maxlength: 40 },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    syncState: { type: String, default: "", trim: true, maxlength: 32 },
    status: { type: String, default: "", trim: true, maxlength: 32 },
    assignee: { type: String, default: "", trim: true, maxlength: 180 },
    notePreview: { type: String, default: "", trim: true, maxlength: 500 },
    peppermintBaseUrl: { type: String, default: "", trim: true, maxlength: 500 },
    peppermintEndpoint: { type: String, default: "", trim: true, maxlength: 200 },
    payload: { type: Schema.Types.Mixed, default: undefined },
    peppermintTicketId: { type: String, default: "", trim: true, maxlength: 120 },
    error: { type: String, default: "", trim: true, maxlength: 4000 },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

TicketAuditEventSchema.index({ localTicketId: 1, at: -1 });
TicketAuditEventSchema.index({ type: 1, at: -1 });

export type TicketAuditEventDocument = InferSchemaType<typeof TicketAuditEventSchema> & {
  _id: Types.ObjectId;
};

export const TicketAuditEventModel =
  models.TicketAuditEvent || model("TicketAuditEvent", TicketAuditEventSchema);
