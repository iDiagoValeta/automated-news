import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SourcesConfig } from "./types.ts";

/** Raíz del repositorio (pipeline/config.ts -> ../). */
export const ROOT = fileURLToPath(new URL("../", import.meta.url));

export function loadConfig(): SourcesConfig {
  const path = fileURLToPath(new URL("../config/sources.json", import.meta.url));
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as SourcesConfig;
}
