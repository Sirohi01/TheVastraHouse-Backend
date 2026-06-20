import assert from "node:assert/strict";
import test from "node:test";
import { detectFileType, validateUploadBuffer } from "./fileSecurityService.js";

test("detectFileType validates real magic bytes instead of extension", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const detected = detectFileType(png);

  assert.equal(detected?.mimeType, "image/png");
  assert.equal(detected?.resourceType, "image");
});

test("validateUploadBuffer rejects disallowed context MIME types", () => {
  const pdf = Buffer.from("255044462d312e340a", "hex");

  assert.throws(() => validateUploadBuffer(pdf, "payment-screenshot"), /File type is not allowed/);
});

test("validateUploadBuffer rejects EICAR malware test payload", () => {
  const malicious = Buffer.concat([
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
  ]);

  assert.throws(() => validateUploadBuffer(malicious, "product-media"), /Malware scan rejected/);
});

test("validateUploadBuffer rejects oversized files server-side", () => {
  const oversized = Buffer.concat([
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.alloc(8 * 1024 * 1024 + 1),
  ]);

  assert.throws(() => validateUploadBuffer(oversized, "review-photo"), /maximum allowed size/);
});
