import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadConfig } from "./config.ts";
import { collectAll } from "./sources/index.ts";
import { normalize } from "./normalize.ts";
import { curate, providerCredentialPresent, resolveProviderName } from "./curate/index.ts";
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

  const items = normalize(collected.items);
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

  const digest = await curate(items, { date, generated_at: generatedAt, provider });

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(digest, null, 2) + "\n", "utf8");
  log(`Edición publicada: ${outPath} — ${digest.items.length} noticias (proveedor ${provider}).`);
}

main().catch((e) => {
  error("Pipeline abortado", e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
