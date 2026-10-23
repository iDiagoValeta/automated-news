import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { SourcesConfig } from "./types.ts";

// Ajv v8 es CJS; createRequire evita el problema de interop con NodeNext.
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Mini-esquema de los campos que el pipeline consume de verdad. No cierra el
 * objeto (`additionalProperties`) porque sources.json irá creciendo con más
 * secciones; el contrato es no dejar pasar un tipo que cambie el
 * comportamiento en silencio (un `enrich_top: "8"` enriquece 0 ítems).
 */
const CONFIG_SCHEMA = {
  type: "object",
  required: [
    "timeout_ms",
    "window_hours",
    "candidate_cap",
    "enrich_top",
    "enrich_timeout_ms",
    "rss",
  ],
  properties: {
    timeout_ms: { type: "integer", minimum: 1 },
    window_hours: { type: "integer", minimum: 1 },
    candidate_cap: { type: "integer", minimum: 1 },
    enrich_top: { type: "integer", minimum: 1 },
    enrich_timeout_ms: { type: "integer", minimum: 1 },
    rss: { type: "array" },
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
