import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseTrendingResult,
  flagTrendingParseAlert,
  parseTrending,
  trendingParseLooksBroken,
} from "../sources/github.ts";
import type { RepoRaw } from "../types.ts";

const html = readFileSync(fileURLToPath(new URL("./fixtures/github-trending.html", import.meta.url)), "utf8");

test("parseTrending extrae nombre, url, descripción, lenguaje y estrellas", () => {
  const repos = parseTrending(html, 25);
  assert.equal(repos.length, 2);

  const [a, b] = repos;
  assert.equal(a.name, "acme/agente-ia");
  assert.equal(a.url, "https://github.com/acme/agente-ia");
  assert.equal(a.description, "An open-source AI agent framework for building tools.");
  assert.equal(a.language, "Python");
  assert.equal(a.stars, 12532);
  assert.equal(a.stars_today, 827);

  // El segundo no tiene lenguaje ni estrellas del día: deben quedar en vacío/0.
  assert.equal(b.name, "foo/mini-tool");
  assert.equal(b.language, "");
  assert.equal(b.stars, 340);
  assert.equal(b.stars_today, 0);
});

test("parseTrending respeta el límite", () => {
  const repos = parseTrending(html, 1);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].name, "acme/agente-ia");
});

test("parseTrending sobre snapshot real de github.com/trending extrae suficientes repos", () => {
  const snapshot = readFileSync(
    fileURLToPath(new URL("./fixtures/github-trending.snapshot.html", import.meta.url)),
    "utf8",
  );
  const repos = parseTrending(snapshot, 25);
  assert.ok(repos.length >= 5, `esperaba ≥5 repos, obtuve ${repos.length}`);
  for (const r of repos) {
    assert.match(r.name, /^[^/]+\/[^/]+$/);
    assert.equal(r.url, `https://github.com/${r.name}`);
    assert.equal(typeof r.description, "string");
    assert.ok(r.stars >= 0);
  }
});

test("trendingParseLooksBroken avisa por debajo del umbral", () => {
  assert.equal(trendingParseLooksBroken(0), true);
  assert.equal(trendingParseLooksBroken(4), true);
  assert.equal(trendingParseLooksBroken(5), false);
  assert.equal(trendingParseLooksBroken(17), false);
});

function repo(name: string): RepoRaw {
  return { name, url: `https://github.com/${name}`, description: "", language: "", stars: 1, stars_today: 1 };
}

test("chooseTrendingResult prefiere el fallback cuando da más repos que el scraping parcial", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];
  const fallback = [repo("api/uno"), repo("api/dos"), repo("api/tres")];
  let calls = 0;

  const choice = await chooseTrendingResult(parsed, 5, async () => {
    calls++;
    return fallback;
  });

  assert.equal(calls, 1);
  assert.equal(choice.source, "search-api");
  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["api/uno", "api/dos", "api/tres"],
  );
});

test("chooseTrendingResult mantiene los parciales si el fallback falla", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];

  const choice = await chooseTrendingResult(parsed, 5, async () => {
    throw new Error("Search API HTTP 403");
  });

  assert.equal(choice.source, "scraping");
  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["scraping/uno", "scraping/dos"],
  );
});

test("chooseTrendingResult mantiene los parciales si el fallback devuelve menos", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];

  const choice = await chooseTrendingResult(parsed, 5, async () => [repo("api/uno")]);

  assert.equal(choice.source, "scraping");
  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["scraping/uno", "scraping/dos"],
  );
});

test("chooseTrendingResult no llama al fallback si el parseo es sano", async () => {
  const parsed = [repo("a/uno"), repo("a/dos"), repo("a/tres"), repo("a/cuatro"), repo("a/cinco")];
  let calls = 0;

  const choice = await chooseTrendingResult(parsed, 5, async () => {
    calls++;
    return [repo("api/uno")];
  });

  assert.equal(calls, 0);
  assert.equal(choice.source, "scraping");
  assert.equal(choice.repos, parsed);
});

test("chooseTrendingResult usa el fallback cuando el scraping no devuelve repos", async () => {
  const choice = await chooseTrendingResult([], 5, async () => [repo("api/uno")]);

  assert.equal(choice.source, "search-api");
  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["api/uno"],
  );
});

test("chooseTrendingResult devuelve vacío si no hay scraping ni fallback", async () => {
  const choice = await chooseTrendingResult([], 5, async () => {
    throw new Error("Search API HTTP 500");
  });

  assert.equal(choice.source, "none");
  assert.deepEqual(choice.repos, []);
});

test("flagTrendingParseAlert escribe GITHUB_OUTPUT cuando existe", () => {
  const dir = mkdtempSync(join(tmpdir(), "trending-alert-"));
  const out = join(dir, "github-output");
  appendFileSync(out, "");
  const prev = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = out;
  try {
    flagTrendingParseAlert();
    const body = readFileSync(out, "utf8");
    assert.match(body, /trending_parse_alert=true/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = prev;
  }
});

