import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, hostnameOf, isBlockedHost, normalize } from "../normalize.ts";
import type { NewsItem } from "../types.ts";

function item(partial: Partial<NewsItem>): NewsItem {
  return {
    title: "t",
    snippet: "",
    url: "https://x.com/a",
    source: "s",
    published_at: "2026-07-17T10:00:00.000Z",
    ...partial,
  };
}

test("canonicalUrl quita tracking, fragmento y barra final", () => {
  assert.equal(canonicalUrl("https://x.com/a/?utm_source=hn&id=3#top"), "https://x.com/a/?id=3");
  assert.equal(canonicalUrl("https://x.com/a/"), "https://x.com/a");
  assert.equal(canonicalUrl("https://x.com/a#seccion"), "https://x.com/a");
  assert.equal(canonicalUrl("https://x.com/a?ref=twitter"), "https://x.com/a");
});

test("normalize deduplica por URL canónica y hereda mayor puntuación", () => {
  const items = [
    item({ url: "https://x.com/a", points: 10 }),
    item({ url: "https://x.com/a/?utm_source=hn", points: 90 }),
    item({ url: "https://y.com/b", points: 5 }),
  ];
  const out = normalize(items);
  assert.equal(out.length, 2, "las dos URLs de x.com/a colapsan en una");
  const a = out.find((i) => i.url === "https://x.com/a");
  assert.ok(a);
  assert.equal(a?.points, 90, "hereda la puntuación más alta");
});

test("normalize ordena por puntos y respeta el cap", () => {
  const items = [
    item({ url: "https://x.com/1", points: 1 }),
    item({ url: "https://x.com/2", points: 100 }),
    item({ url: "https://x.com/3", points: 50 }),
  ];
  const out = normalize(items, 2);
  assert.equal(out.length, 2, "aplica el cap");
  assert.equal(out[0].url, "https://x.com/2", "mayor puntuación primero");
  assert.equal(out[1].url, "https://x.com/3");
});

test("isBlockedHost cubre el dominio y sus subdominios", () => {
  const blocked = ["canews24.online"];
  assert.equal(isBlockedHost("canews24.online", blocked), true);
  assert.equal(isBlockedHost("www.canews24.online", blocked), true);
  assert.equal(isBlockedHost("theverge.com", blocked), false);
  assert.equal(hostnameOf("https://canews24.online/?p=71"), "canews24.online");
});

test("normalize descarta el rehost canews24.online de Hacker News", () => {
  const items = [
    item({
      url: "https://canews24.online/?p=71",
      source: "Hacker News",
      title: "Estudio sobre IA en exámenes",
      points: 80,
    }),
    item({
      url: "https://www.canews24.online/otra",
      source: "Hacker News",
      points: 60,
    }),
    item({
      url: "https://www.theverge.com/ai/ok",
      source: "The Verge",
      points: 10,
    }),
  ];
  const out = normalize(items, 120, ["canews24.online"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://www.theverge.com/ai/ok");
  assert.ok(out.every((i) => !i.url.includes("canews24")));
});

