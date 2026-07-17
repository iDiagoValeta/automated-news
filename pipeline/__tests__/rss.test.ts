import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Parser from "rss-parser";
import { mapFeedItems } from "../sources/rss.ts";

const parser = new Parser();
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// "now" fijo: 2026-07-17T22:00:00Z. Ventana de 24h.
const NOW = Date.parse("2026-07-17T22:00:00Z");
const WINDOW = 24 * 3600_000;

test("feed real (Anthropic): parsea y mapea con ventana amplia", async () => {
  const feed = await parser.parseString(fixture("anthropic.xml"));
  const items = mapFeedItems(feed.items ?? [], "Anthropic News", 1000 * 24 * 3600_000, NOW);
  assert.ok(items.length > 0, "debe extraer ítems del feed real");
  for (const it of items) {
    assert.match(it.url, /^https?:\/\//, "toda URL debe ser http(s)");
    assert.equal(it.source, "Anthropic News");
    assert.ok(it.title.length > 0);
    assert.ok(!Number.isNaN(Date.parse(it.published_at)));
  }
});

test("guid como respaldo de link, ventana y saneado (fixture sintético)", async () => {
  const feed = await parser.parseString(fixture("synthetic.xml"));
  const items = mapFeedItems(feed.items ?? [], "Synthetic", WINDOW, NOW);
  const urls = items.map((i) => i.url);

  assert.ok(urls.includes("https://example.com/con-link"), "item con link");
  assert.ok(urls.includes("https://example.com/desde-guid"), "guid usado como URL de respaldo");
  assert.ok(urls.includes("https://example.com/sin-fecha"), "item sin fecha se incluye");
  assert.ok(!urls.includes("https://example.com/antiguo"), "item fuera de ventana se descarta");
  assert.ok(
    !urls.some((u) => u.startsWith("tag:")),
    "guid que no es URL (y sin link) se descarta",
  );
  assert.equal(items.length, 3);
});
