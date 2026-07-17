import { createRequire } from "node:module";
import schema from "../schema/digest.schema.json" with { type: "json" };
import type { Digest } from "./types.ts";

// Ajv v8 y ajv-formats son CJS; createRequire evita los problemas de interop
// CJS<->ESM de NodeNext sin sacrificar el runtime.
const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Valida un digest contra el JSON Schema (Ajv) y aplica la comprobación extra
 * fuera del schema: cada `url` del digest debe existir en las URLs de entrada
 * (el LLM elige, nunca inventa).
 */
export function validateDigest(digest: unknown, inputUrls: Set<string>): ValidationResult {
  const errors: string[] = [];

  if (!validateSchema(digest)) {
    for (const e of validateSchema.errors ?? []) {
      errors.push(`schema${e.instancePath || ""} ${e.message ?? "inválido"}`);
    }
    return { ok: false, errors };
  }

  // A partir de aquí `digest` cumple el schema.
  const d = digest as Digest;
  d.items.forEach((item, i) => {
    if (!inputUrls.has(item.url)) {
      errors.push(`items[${i}].url no coincide con ninguna URL de entrada: ${item.url}`);
    }
  });

  const ranks = d.items.map((it) => it.rank);
  if (new Set(ranks).size !== ranks.length) {
    errors.push("items[].rank contiene valores repetidos");
  }

  return { ok: errors.length === 0, errors };
}
