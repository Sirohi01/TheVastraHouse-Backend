import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { AuditLog } from "../models/AuditLog.js";
import { buildAuditLogPayload } from "./auditLogService.js";

test("buildAuditLogPayload captures actor, entity, action, and before-after state", () => {
  const actorId = new Types.ObjectId();
  const entityId = new Types.ObjectId();

  const payload = buildAuditLogPayload({
    actor: {
      actorId,
      actorType: "admin",
      role: "Super Admin",
      ipAddress: "127.0.0.1",
    },
    entity: {
      type: "Brand",
      id: entityId,
      displayId: "the-vastra-house",
    },
    action: "update",
    before: { active: false },
    after: { active: true },
  });

  assert.equal(payload.actor.actorId, actorId);
  assert.equal(payload.entity.id, entityId);
  assert.equal(payload.action, "update");
  assert.deepEqual(payload.before, { active: false });
  assert.deepEqual(payload.after, { active: true });
});

test("AuditLog model adds immutable timestamp for a sample audited entity", () => {
  const document = new AuditLog(
    buildAuditLogPayload({
      actor: {
        actorType: "system",
      },
      entity: {
        type: "Brand",
        id: new Types.ObjectId(),
      },
      action: "create",
      after: { name: "The Vastra House" },
    }),
  );

  const validationError = document.validateSync();

  assert.equal(validationError, undefined);
  assert.ok(document.createdAt instanceof Date);
});
