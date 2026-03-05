import { Schema, model, models, type InferSchemaType, type Types } from "mongoose";

const TicketSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 220 },
    description: { type: String, required: true, trim: true, minlength: 8, maxlength: 8000 },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved"],
      default: "open",
      required: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
      required: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAdmin: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
    adminResponse: { type: String, default: "", maxlength: 8000 },
    resolvedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

TicketSchema.index({ createdBy: 1, createdAt: -1 });
TicketSchema.index({ status: 1, priority: 1, createdAt: -1 });
TicketSchema.index({ assignedAdmin: 1, status: 1, createdAt: -1 });

export type TicketDocument = InferSchemaType<typeof TicketSchema> & {
  _id: Types.ObjectId;
};

export const TicketModel = models.Ticket || model("Ticket", TicketSchema);
