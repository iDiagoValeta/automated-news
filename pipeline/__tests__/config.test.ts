import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateSourcesConfig } from "../config.ts";

const CONFIG_PATH = fileURLToPath(new URL("../../config/sources.json", import.meta.url));

function validConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
}

test("el config/sources.json actual valida", () => {
  const cfg = validateSourcesConfig(validConfig());
  // Se comprueba el contrato, no el valor de hoy: subir el tope no debe romper el test.
  assert.ok(Number.isInteger(cfg.candidate_cap) && cfg.candidate_cap > 0);
  assert.ok(Array.isArray(cfg.rss));
});

test("user_agent ausente falla nombrando el campo", () => {
  const cfg = validConfig();
  delete cfg.user_agent;
  assert.throws(() => validateSourcesConfig(cfg), /user_agent/);
});

test("user_agent no string falla nombrando el campo", () => {
  const cfg = validConfig();
  cfg.user_agent = 42;
  assert.throws(() => validateSourcesConfig(cfg), /user_agent/);
});

test("blocked_domains ausente falla nombrando el campo", () => {
  const cfg = validConfig();
  delete cfg.blocked_domains;
  assert.throws(() => validateSourcesConfig(cfg), /blocked_domains/);
});

test("candidate_cap ausente falla nombrando el campo", () => {
  const cfg = validConfig();
  delete cfg.candidate_cap;
  assert.throws(() => validateSourcesConfig(cfg), /candidate_cap/);
});

test("enrich_top como string falla nombrando el campo", () => {
  const cfg = validConfig();
  cfg.enrich_top = "8";
  assert.throws(() => validateSourcesConfig(cfg), /enrich_top/);
});

test("un entero no positivo falla nombrando el campo", () => {
  const cfg = validConfig();
  cfg.window_hours = 0;
  assert.throws(() => validateSourcesConfig(cfg), /window_hours/);
});

test("hackernews ausente falla nombrando la sección", () => {
  const cfg = validConfig();
  delete cfg.hackernews;
  assert.throws(() => validateSourcesConfig(cfg), /hackernews/);
});

test("enabled no booleano en hackernews falla nombrando sección y campo", () => {
  const cfg = validConfig();
  (cfg.hackernews as Record<string, unknown>).enabled = "false";
  assert.throws(() => validateSourcesConfig(cfg), /hackernews\/enabled/);
});

test("la sección lecturas es opcional", () => {
  const cfg = validConfig();
  delete cfg.lecturas;
  assert.doesNotThrow(() => validateSourcesConfig(cfg));
});

test("lecturas con un tipo equivocado falla nombrando sección y campo", () => {
  const cfg = validConfig();
  (cfg.lecturas as Record<string, unknown>).pick = "6";
  assert.throws(() => validateSourcesConfig(cfg), /lecturas\/pick/);
});
