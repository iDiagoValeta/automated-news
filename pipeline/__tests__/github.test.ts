import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  flagTrendingParseAlert,
  parseTrending,
  trendingParseLooksBroken,
} from "../sources/github.ts";

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

