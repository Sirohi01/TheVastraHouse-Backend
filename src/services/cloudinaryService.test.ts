import assert from "node:assert/strict";
import test from "node:test";
import { v2 as cloudinary } from "cloudinary";
import { buildRenditionSizes, buildRenditions, getDeliveryType } from "./cloudinaryService.js";

test("buildRenditions derives responsive Cloudinary URLs without changing original public id", () => {
  cloudinary.config({ cloud_name: "demo", secure: true });
  const renditions = buildRenditions("vastra-house/media/sample", "4:5");

  assert.equal(renditions.length, 3);
  assert.ok(renditions[0].url.includes("vastra-house/media/sample"));
  assert.equal(renditions[0].width, 480);
  assert.equal(renditions[0].height, 600);
});

test("buildRenditions respects square and landscape aspect ratios", () => {
  cloudinary.config({ cloud_name: "demo", secure: true });

  const square = buildRenditions("vastra-house/media/square", "1:1");
  const landscape = buildRenditions("vastra-house/media/landscape", "16:9");

  assert.deepEqual(
    square.map(({ width, height }) => ({ width, height })),
    [
      { width: 480, height: 480 },
      { width: 768, height: 768 },
      { width: 1200, height: 1200 },
    ],
  );
  assert.deepEqual(
    landscape.map(({ width, height }) => ({ width, height })),
    [
      { width: 480, height: 270 },
      { width: 768, height: 432 },
      { width: 1200, height: 675 },
    ],
  );
  assert.ok(square[0].url.includes("h_480"));
  assert.ok(landscape[0].url.includes("h_270"));
});

test("buildRenditionSizes uses caller-provided custom aspect ratio dimensions", () => {
  assert.deepEqual(buildRenditionSizes("custom", { width: 3, height: 2 }), [
    { width: 480, height: 320 },
    { width: 768, height: 512 },
    { width: 1200, height: 800 },
  ]);
  assert.throws(() => buildRenditionSizes("custom"), /Custom aspect ratio dimensions/);
});

test("payment screenshots use authenticated delivery", () => {
  assert.equal(getDeliveryType("payment-screenshot"), "authenticated");
  assert.equal(getDeliveryType("product-media"), "upload");
});

test("authenticated renditions are signed URLs", () => {
  cloudinary.config({ cloud_name: "demo", api_secret: "secret", secure: true });
  const renditions = buildRenditions("vastra-house/media/sensitive", "1:1", "authenticated");

  assert.ok(renditions[0].url.includes("/authenticated/"));
  assert.ok(renditions[0].url.includes("/s--"));
});
