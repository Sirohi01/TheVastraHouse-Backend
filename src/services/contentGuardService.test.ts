import assert from "node:assert/strict";
import test from "node:test";
import { findInternalNote, stripInternalNotes } from "./contentGuardService.js";

test("flags the leaked Hinglish drafting note", () => {
  const note =
    "Soft and breathable cotton-based fabric. Note: Exact cotton percentage ho to wahi add karna; confirm na ho to “100% Cotton” mat likhna.";
  assert.ok(findInternalNote(note));
  assert.equal(stripInternalNotes(note), "Soft and breathable cotton-based fabric.");
});

test("flags TODO, placeholders and template tokens", () => {
  assert.ok(findInternalNote("TODO: add fabric"));
  assert.ok(findInternalNote("Lorem ipsum dolor"));
  assert.ok(findInternalNote("Made of {{fabric}}"));
  assert.ok(findInternalNote("Do not publish until confirmed"));
});

test("accepts legitimate customer copy", () => {
  for (const text of [
    "Soft and breathable cotton-based fabric with an all-over floral print.",
    "Gentle hand wash separately in cold water. Dry in shade.",
    "Note: product measurements may vary slightly due to manual measurement.",
    "Premium Rayon Blend (180 GSM), Soft Finish, Breathable, Lightweight.",
  ]) {
    assert.equal(findInternalNote(text), undefined, text);
  }
});
