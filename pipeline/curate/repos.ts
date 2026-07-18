import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import type { Digest, Repo, RepoRaw } from "../types.ts";
import type { Provider } from "./index.ts";

const REPOS_PROMPT_PATH = fileURLToPath(new URL("../../prompts/repos.md", import.meta.url));

interface PickedRepo {
  name?: string;
  url?: string;
  description?: string;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

function buildReposPrompt(trending: RepoRaw[], pick: number): string {
  const header = `Elige los ${pick} repositorios más interesantes y descríbelos en castellano.\n\nRepositorios en tendencia hoy en GitHub:\n\n`;
  const body = trending
    .map((r, i) => {
      const meta = [r.language, r.stars ? `${r.stars}★` : ""].filter(Boolean).join(" · ");
      const metaLine = meta ? ` (${meta})` : "";
      return `${i + 1}. ${r.name}${metaLine}\n   ${r.description || "(sin descripción)"}`;
    })
    .join("\n\n");
  return header + body;
}

/**
 * Tercera llamada al modelo (best effort): de los repos en tendencia, el modelo
 * elige los más interesantes y los describe en español. Rellena `digest.repos`.
 * Los datos duros (name, url, language, stars) se toman SIEMPRE del repo recogido,
 * no de la respuesta del modelo, para no aceptar URLs ni cifras inventadas; del
 * modelo solo se usa la descripción. Si falla, la edición se publica sin sección.
 */
export async function attachRepos(
  provider: Provider,
  digest: Digest,
  trending: RepoRaw[],
  pick: number,
): Promise<void> {
  if (trending.length === 0) return;
  try {
    const system = readFileSync(REPOS_PROMPT_PATH, "utf8");
    const raw = await provider.generate(system, buildReposPrompt(trending, pick));
    const parsed = JSON.parse(stripFences(raw)) as { repos?: PickedRepo[] };
    const picked = parsed.repos ?? [];
    const byName = new Map(trending.map((r) => [r.name, r]));

    const repos: Repo[] = [];
    for (const p of picked) {
      if (typeof p.name !== "string") continue;
      const src = byName.get(p.name);
      if (!src) continue; // el modelo no puede introducir repos ausentes de la entrada
      const description = (typeof p.description === "string" && p.description.trim() ? p.description : src.description).trim();
      if (!description) continue;
      repos.push({
        name: src.name,
        url: src.url,
        description,
        language: src.language || undefined,
        stars: src.stars || undefined,
      });
      if (repos.length >= pick) break;
    }

    if (repos.length > 0) {
      digest.repos = repos;
      log(`Repos hot: ${repos.length} seleccionados de ${trending.length} en tendencia.`);
    }
  } catch (e) {
    warn("No se pudo generar la sección de repos; la edición se publica sin ella.", String(e));
  }
}
