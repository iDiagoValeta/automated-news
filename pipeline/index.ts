import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadConfig } from "./config.ts";
import { collectAll } from "./sources/index.ts";
import { collectGithubTrending } from "./sources/github.ts";
import { normalize } from "./normalize.ts";
import { enrich } from "./enrich.ts";
import { curate, providerCredentialPresent, resolveProviderName } from "./curate/index.ts";
import type { ReposInput } from "./curate/index.ts";
import { excludeRecentRepos, loadRecentRepoNames } from "./curate/repos.ts";
import { error, log } from "./log.ts";

/** Fecha de la edición en zona Europe/Madrid, formato YYYY-MM-DD. */
function madridDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

  // Idempotencia: no re-llamar al LLM si ya existe la edición de hoy.
  if (!collectOnly && existsSync(outPath)) {
    log(`Ya existe ${outPath}. Idempotencia: nada que hacer.`);
    return;
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

  const items = normalize(collected.items, cfg.candidate_cap);
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

  const digest = await curate(items, { date, generated_at: generatedAt, provider }, repos);

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(digest, null, 2) + "\n", "utf8");
  log(`Edición publicada: ${outPath} — ${digest.items.length} noticias (proveedor ${provider}).`);
}

main().catch((e) => {
  error("Pipeline abortado", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
