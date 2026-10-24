import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { SourcesConfig } from "./types.ts";

// Ajv v8 es CJS; createRequire evita el problema de interop con NodeNext.
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Mini-esquema de los campos que el pipeline consume de verdad. La raíz no se
 * cierra (`additionalProperties`) porque sources.json irá creciendo con más
 * secciones, pero las que el pipeline lee sí se exigen y se tipan: el contrato
 * es no dejar pasar un tipo que cambie el comportamiento en silencio (un
 * `enrich_top: "8"` enriquece 0 ítems, un `"enabled": "false"` no desactiva
 * nada). Mismo motivo dentro de `rss`: un `url` ausente deja la fuente rota.
 */
const RSS_ITEM_SCHEMA = {
  type: "object",
  required: ["id", "name", "url", "enabled", "fragile"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    url: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    fragile: { type: "boolean" },
  },
};

const HACKERNEWS_SCHEMA = {
  type: "object",
  required: ["id", "name", "enabled", "min_points", "queries"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    enabled: { type: "boolean" },
    min_points: { type: "integer", minimum: 0 },
    queries: { type: "array", items: { type: "string" } },
  },
};

const HUGGINGFACE_TRENDING_SCHEMA = {
  type: "object",
  required: ["id", "name", "enabled", "limit"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    enabled: { type: "boolean" },
    limit: { type: "integer", minimum: 1 },
  },
};

const GITHUB_TRENDING_SCHEMA = {
  type: "object",
  required: ["id", "name", "enabled", "since", "limit", "pick"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    enabled: { type: "boolean" },
    since: { type: "string", enum: ["daily", "weekly", "monthly"] },
    limit: { type: "integer", minimum: 1 },
    pick: { type: "integer", minimum: 1 },
    min_parse_alert: { type: "integer", minimum: 1 },
  },
};

/**
 * Sección "Lecturas". La ventana es propia porque estas fuentes publican
 * material atemporal que en 24 h dejaría la lista casi vacía.
 */
const LECTURAS_SCHEMA = {
  type: "object",
  required: ["enabled", "window_hours", "candidate_cap", "pick", "lookback_days", "feeds"],
  properties: {
    enabled: { type: "boolean" },
    window_hours: { type: "integer", minimum: 1 },
    candidate_cap: { type: "integer", minimum: 1 },
    // El schema del digest admite como máximo 10 lecturas: un pick mayor
    // publicaría un JSON que el contrato rechaza.
    pick: { type: "integer", minimum: 1, maximum: 10 },
    lookback_days: { type: "integer", minimum: 0 },
    feeds: { type: "array", items: RSS_ITEM_SCHEMA },
  },
};

const CONFIG_SCHEMA = {
  type: "object",
  required: [
    "user_agent",
    "timeout_ms",
    "window_hours",
    "candidate_cap",
    "enrich_top",
    "enrich_timeout_ms",
    "blocked_domains",
    "rss",
    "hackernews",
    "huggingface_trending",
    "github_trending",
  ],
  properties: {
    user_agent: { type: "string", minLength: 1 },
    timeout_ms: { type: "integer", minimum: 1 },
    window_hours: { type: "integer", minimum: 1 },
    candidate_cap: { type: "integer", minimum: 1 },
    enrich_top: { type: "integer", minimum: 1 },
    enrich_timeout_ms: { type: "integer", minimum: 1 },
    rss: { type: "array", items: RSS_ITEM_SCHEMA },
    hackernews: HACKERNEWS_SCHEMA,
    huggingface_trending: HUGGINGFACE_TRENDING_SCHEMA,
    github_trending: GITHUB_TRENDING_SCHEMA,
    lecturas: LECTURAS_SCHEMA,
    blocked_domains: { type: "array", items: { type: "string" } },
  },
  additionalProperties: true,
};

const validateConfig = ajv.compile(CONFIG_SCHEMA);

interface ConfigValidationError {
  instancePath: string;
  message?: string;
  params?: { missingProperty?: string };
}

/** Raíz del repositorio (pipeline/config.ts -> ../). */
export const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Valida la forma del JSON antes de devolverlo. Función pura para poder
 * probarla sin tocar el fichero real. Lanza nombrando el campo culpable.
 */
export function validateSourcesConfig(raw: unknown): SourcesConfig {
  if (!validateConfig(raw)) {
    const errors = ((validateConfig.errors ?? []) as ConfigValidationError[]).map((e) => {
      const field = e.instancePath
        ? e.instancePath.replace(/^\//, "")
        : (e.params?.missingProperty ?? "");
      return field ? `${field}: ${e.message ?? "inválido"}` : (e.message ?? "inválido");
    });
    throw new Error(`config/sources.json inválido: ${errors.join("; ")}`);
  }
  return raw as SourcesConfig;
}

export function loadConfig(): SourcesConfig {
  const path = fileURLToPath(new URL("../config/sources.json", import.meta.url));
  const raw = readFileSync(path, "utf8");
  return validateSourcesConfig(JSON.parse(raw));
}
