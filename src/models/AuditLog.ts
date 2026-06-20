import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const auditActions = ["create", "update", "delete", "restore", "login", "export"] as const;
export type AuditAction = (typeof auditActions)[number];

const auditActorSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: {
      type: String,
      enum: ["customer", "admin", "system"],
      required: true,
    },
    role: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { _id: false },
);

const auditLogSchema = new Schema(
  {
    actor: { type: auditActorSchema, required: true },
    entity: {
      type: {
        type: String,
        required: true,
        trim: true,
      },
      id: { type: Schema.Types.ObjectId },
      displayId: { type: String, trim: true },
    },
    action: { type: String, enum: auditActions, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, immutable: true, index: true },
  },
  {
    versionKey: false,
  },
);

auditLogSchema.index({ "entity.type": 1, "entity.id": 1, createdAt: -1 });
auditLogSchema.index({ "actor.actorId": 1, createdAt: -1 });

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>;

export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
