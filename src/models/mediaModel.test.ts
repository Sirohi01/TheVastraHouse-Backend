import assert from "node:assert/strict";
import test from "node:test";
import { Media } from "./Media.js";

test("Media model requires selected aspect ratio and preserves original URL", () => {
  const media = new Media({
    originalUrl: "https://res.cloudinary.com/demo/image/upload/original.jpg",
    secureUrl: "https://res.cloudinary.com/demo/image/upload/original.jpg",
    publicId: "vastra-house/media/original",
    resourceType: "image",
    deliveryType: "upload",
    uploadContext: "product-media",
    mimeType: "image/jpeg",
    bytes: 1024,
    altText: "Original product image",
    selectedAspectRatio: "4:5",
    renditions: [
      {
        width: 480,
        height: 600,
        url: "https://res.cloudinary.com/demo/image/upload/w_480,h_600/original.jpg",
        format: "auto",
      },
    ],
    scanStatus: "clean",
  });

  const validationError = media.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(media.status, "active");
  assert.equal(media.originalUrl, media.secureUrl);
});
