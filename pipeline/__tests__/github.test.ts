import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTrending } from "../sources/github.ts";

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
