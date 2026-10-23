import { test } from "node:test";
import assert from "node:assert/strict";
import { hitToNewsItem } from "../sources/hackernews.ts";

const NOW = Date.parse("2026-07-18T10:00:00Z");

test("un hit de HN sin título se descarta", () => {
  assert.equal(
    hitToNewsItem({ title: "   ", url: "https://example.com/x", created_at_i: 1 }),
    null,
  );
  assert.equal(
    hitToNewsItem({ url: "https://example.com/x", created_at_i: 1 }),
    null,
  );
});

test("un hit sin URL externa se descarta", () => {
  assert.equal(hitToNewsItem({ title: "Ask HN: algo" }), null);
});

test("recorta el titular a 200 caracteres", () => {
  const item = hitToNewsItem(
    {
      title: "H".repeat(250),
      url: "https://example.com/hn",
      points: 120,
      created_at_i: Math.floor(NOW / 1000),
    },
  );
  assert.ok(item);
  assert.equal(item.title.length, 200);
  assert.equal(item.title, "H".repeat(200));
  assert.equal(item.points, 120);
});
