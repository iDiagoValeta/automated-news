import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, loadConfig } from "./config.ts";
import { collectAll } from "./sources/index.ts";
import { collectGithubTrending } from "./sources/github.ts";
import { normalize } from "./normalize.ts";
import { enrich } from "./enrich.ts";
import { curate } from "./curate/index.ts";
import { providerCredentialPresent, resolveProviderChain, resolveProviderName } from "./providers.ts";
import type { ReposInput } from "./curate/index.ts";
import { excludeRecentRepos, loadRecentRepoNames } from "./curate/repos.ts";
import { error, log, warn } from "./log.ts";

/** Fecha de la edición en zona Europe/Madrid, formato YYYY-MM-DD. */
function madridDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface ExistingDigestStatus {
  /** El fichero de la edición existe. */
  exists: boolean;
  /** Se puede respetar la idempotencia. */
  reusable: boolean;
  /** Motivo cuando no se reutiliza (vacío si sí). */
  reason: string;
}

/**
 * Decide si la edición de hoy ya está publicada y se puede respetar. Existir no
 * basta: un crash a mitad de escritura deja un JSON truncado, y la idempotencia
 * lo daría por bueno para siempre (issue #44). Se exige solo la forma mínima
 * que deja un fichero escrito entero (fecha e ítems con url y título), no el
 * esquema vigente: endurecer la validación un día con la edición ya publicada
 * la daría por inválida y se pagaría otra curación para sobrescribirla.
 */
export function checkExistingDigest(path: string): ExistingDigestStatus {
  if (!existsSync(path)) return { exists: false, reusable: false, reason: "no existe" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return {
      exists: true,
      reusable: false,
      reason: `no parsea como JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }

  const d = parsed as { date?: unknown; items?: unknown } | null;
  const items = Array.isArray(d?.items) ? d.items : [];
  const completo =
    typeof d?.date === "string" &&
    items.length > 0 &&
    items.every((it) => {
      const item = it as { url?: unknown; title?: unknown } | null;
      return typeof item?.url === "string" && typeof item?.title === "string";
    });
  if (!completo) {
    return { exists: true, reusable: false, reason: "sin date o sin items completos (url y title)" };
  }
  return { exists: true, reusable: true, reason: "" };
}

/**
 * Escribe primero un temporal en el mismo directorio y renombra: renameSync es
 * atómico en el mismo filesystem, así que nadie ve el fichero final a medias.
 */
export function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const collectOnly = process.argv.includes("--collect-only");
  const cfg = loadConfig();
  const now = new Date();
  const date = madridDate(now);
  const generatedAt = now.toISOString();

  const dataDir = join(ROOT, "data");
  const outPath = join(dataDir, `${date}.json`);
  const provider = resolveProviderName();

  // Idempotencia: no re-llamar al LLM si ya existe una edición de hoy válida.
  if (!collectOnly) {
    const existing = checkExistingDigest(outPath);
    if (existing.reusable) {
      log(`Ya existe ${outPath} y es válido. Idempotencia: nada que hacer.`);
      return;
    }
    if (existing.exists) {
      warn(`El fichero ${outPath} existe pero no es reutilizable (${existing.reason}). Se regenera.`);
    }
  }

  // Sin credencial de proveedor no es un error: se mantiene la última edición
  // publicada y el sitio se reconstruye igualmente. Solo los fallos reales
  // (API caída, validación) abortan con exit != 0.
  if (!collectOnly && !providerCredentialPresent(provider)) {
    log(
      `Proveedor "${provider}" sin credencial. No se genera edición nueva; ` +
        `se mantiene la última publicada.`,
    );
    return;
  }

  log(`Recogida de fuentes para la edición ${date}...`);
  const collected = await collectAll(cfg);
  if (collected.succeeded === 0) {
    throw new Error(`Todas las fuentes fallaron (${collected.failures.join(", ")}). Se aborta sin publicar.`);
  }

  const items = normalize(collected.items, cfg.candidate_cap, cfg.blocked_domains ?? []);
  log(
    `Normalizados ${items.length} ítems únicos de ${collected.items.length} recogidos ` +
      `(${collected.succeeded}/${collected.attempted} fuentes OK).`,
  );

  // Fase (a): salida a consola para verificar recogida + normalización.
  if (collectOnly) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }

  if (items.length < 6) {
    throw new Error(`Solo ${items.length} ítems normalizados; se necesitan al menos 6. No se publica.`);
  }

  // Enriquecimiento: leer el artículo real de los candidatos con más señal.
  await enrich(items, cfg);

  // Repos en tendencia de GitHub para la sección "Repositorios hot" (best effort).
  // Se excluyen los publicados en los 7 días previos para no repetir entre ediciones.
  let repos: ReposInput | undefined;
  if (cfg.github_trending.enabled) {
    const trending = await collectGithubTrending(cfg, cfg.github_trending);
    const recent = loadRecentRepoNames(dataDir, date);
    const fresh = excludeRecentRepos(trending, recent);
    log(
      `GitHub trending: ${trending.length} recogidos, ${fresh.length} tras excluir ` +
        `${trending.length - fresh.length} ya publicados en los últimos 7 días.`,
    );
    repos = { trending: fresh, pick: cfg.github_trending.pick };
  }

  const digest = await curate(items, { date, generated_at: generatedAt, provider }, repos, resolveProviderChain(provider));

  mkdirSync(dataDir, { recursive: true });
  writeFileAtomic(outPath, JSON.stringify(digest, null, 2) + "\n");
  log(`Edición publicada: ${outPath} — ${digest.items.length} noticias (proveedor ${provider}).`);
}

// Permite importar las funciones de este módulo desde los tests sin ejecutar
// el pipeline al cargarlo.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    error("Pipeline abortado", e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  });
}
