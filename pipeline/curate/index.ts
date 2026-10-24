import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import { ProviderError } from "../ports.ts";
import type { Provider } from "../ports.ts";
import { dropInventedUrlItems, validateDigest } from "../validate.ts";
import type { Digest, NewsItem, ProviderName, RepoRaw } from "../types.ts";
import { attachRepoSocial, attachSocial } from "./social.ts";
import { attachRepos } from "./repos.ts";
import { attachLecturas } from "./lecturas.ts";
import { collapseText, stripFences, untrustedBlock } from "./prompt.ts";

/** Repos en tendencia y cuántos elegir; se resuelven fuera (best effort). */
export interface ReposInput {
  trending: RepoRaw[];
  pick: number;
}

/** Candidatos de la sección Lecturas y cuántos elegir. */
export interface LecturasInput {
  candidates: NewsItem[];
  pick: number;
}

const PROMPT_PATH = fileURLToPath(new URL("../../prompts/curacion.md", import.meta.url));
const MAX_ATTEMPTS = 3; // 1 intento + hasta 2 reintentos
/** Espera base del backoff: 2 s tras el primer fallo, 4 s tras el segundo. */
const BACKOFF_BASE_MS = 2000;

export interface CurateMeta {
  date: string;
  generated_at: string;
  provider: ProviderName;
  /** Ventana real de recogida; se interpola en el prompt para no mentir al modelo. */
  window_hours: number;
}

type CurateOutcome =
  | { ok: true; digest: Digest }
  | { ok: false; attempts: number; errors: string[] };

interface ProviderFailure {
  provider: ProviderName;
  attempts: number;
  errors: string[];
}

/** La espera real; los tests inyectan una versión instantánea. */
async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paso 3 del pipeline. Llama al LLM configurado, valida la salida contra el
 * schema + comprobación de URLs, y reintenta hasta 2 veces. Un error
 * reintentable de generate() consume intento y espera un backoff creciente
 * (2 s, 4 s) antes del siguiente; uno permanente (401, 400) no se repite y
 * pasa directo al proveedor alternativo. Un fallo de JSON/schema inyecta el
 * error en el prompt. Si el proveedor principal agota los intentos, se prueba
 * el alternativo cuando su credencial está presente. Lanza si tras toda la
 * cadena sigue sin validar, con los intentos reales y los errores de todos los
 * proveedores.
 *
 * `chain` llega ya resuelta desde la raíz de composición (providers.ts),
 * de modo que el caso de uso no conoce ningún adaptador concreto.
 * `sleep` se inyecta para que los tests no esperen de verdad.
 */
export async function curate(
  items: NewsItem[],
  meta: CurateMeta,
  repos: ReposInput | undefined,
  chain: Provider[],
  sleep: (ms: number) => Promise<void> = defaultSleep,
  lecturas?: LecturasInput,
): Promise<Digest> {
  if (chain.length === 0) {
    throw new Error("No hay proveedores LLM disponibles para curar.");
  }

  const failures: ProviderFailure[] = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    if (i > 0) {
      log(`Failover: se reintenta la curación con ${provider.name} tras fallar ${chain[i - 1].name}.`);
    }
    const attemptMeta: CurateMeta = { ...meta, provider: provider.name };
    const outcome = await curateWithProvider(items, attemptMeta, provider, repos, sleep, lecturas);
    if (outcome.ok) return outcome.digest;
    failures.push({ provider: provider.name, attempts: outcome.attempts, errors: outcome.errors });
  }

  const totalAttempts = failures.reduce((sum, f) => sum + f.attempts, 0);
  const attemptsByProvider = failures.map((f) => `${f.provider}: ${f.attempts}`).join(", ");
  const allErrors = failures
    .map((f) => `[${f.provider}] ${f.errors.join(" | ")}`)
    .join(" | ");

  throw new Error(
    `Curación falló tras ${totalAttempts} intentos con ${chain.map((p) => p.name).join(", ")} ` +
      `(${attemptsByProvider}). Errores: ${allErrors}`,
  );
}

async function curateWithProvider(
  items: NewsItem[],
  meta: CurateMeta,
  provider: Provider,
  repos: ReposInput | undefined,
  sleep: (ms: number) => Promise<void>,
  lecturas: LecturasInput | undefined,
): Promise<CurateOutcome> {
  const systemPrompt = readFileSync(PROMPT_PATH, "utf8");
  const inputUrls = new Set(items.map((i) => i.url));
  const baseUserPrompt = buildUserPrompt(items, meta);

  let userPrompt = baseUserPrompt;
  let lastErrors: string[] = ["desconocido"];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    let raw: string;
    try {
      raw = await provider.generate(systemPrompt, userPrompt);
    } catch (e) {
      lastErrors = [`Error de red o de proveedor: ${String(e)}`];
      warn(`Intento ${attempt}: generate() falló`, String(e));
      // La red no produjo JSON: reintentar con el prompt base, no con el error.
      userPrompt = baseUserPrompt;
      // Un error sin la marca ProviderError se considera transitorio (red,
      // timeout); los permanentes se marcan como no reintentables en el adaptador.
      const retryable = !(e instanceof ProviderError) || e.retryable;
      if (!retryable) {
        warn(`Proveedor ${provider.name}: error no reintentable; se pasa al siguiente.`);
        break;
      }
      if (attempt < MAX_ATTEMPTS) {
        const delay = BACKOFF_BASE_MS * attempt;
        log(`Reintento con ${provider.name} en ${delay / 1000} s.`);
        await sleep(delay);
      }
      continue;
    }
    log(`Curación (${provider.name}) intento ${attempt}/${MAX_ATTEMPTS}: ${raw.length} chars`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (e) {
      lastErrors = [`La salida no es JSON válido: ${String(e)}`];
      warn(`Intento ${attempt}: JSON inválido`, raw.slice(0, 300));
      userPrompt = withErrors(baseUserPrompt, lastErrors);
      continue;
    }

    const digest = coerceMeta(parsed, meta);
    // Un ítem con URL que el LLM no copió de la entrada no debe tumbar toda la
    // edición: se descarta y se sigue con el resto (si tras ello faltan ítems,
    // el schema lo detecta y se reintenta como antes).
    const dropped = dropInventedUrlItems(digest, inputUrls);
    if (dropped > 0) {
      warn(`Intento ${attempt}: descartados ${dropped} ítem(s) con URL fuera de la entrada.`);
    }
    const result = validateDigest(digest, inputUrls);
    if (result.ok) {
      const valid = digest as Digest;
      log(`Curación válida al intento ${attempt}: ${valid.items.length} noticias`);
      await attachSocial(provider, valid);
      if (repos && repos.trending.length > 0) {
        await attachRepos(provider, valid, repos.trending, repos.pick);
        await attachRepoSocial(provider, valid);
      }
      if (lecturas && lecturas.candidates.length > 0) {
        await attachLecturas(provider, valid, lecturas.candidates, lecturas.pick);
      }
      return { ok: true, digest: valid };
    }

    lastErrors = result.errors;
    warn(`Intento ${attempt}: validación falló`, lastErrors);
    userPrompt = withErrors(baseUserPrompt, lastErrors);
  }

  return { ok: false, attempts, errors: lastErrors };
}

/** Forzamos date/generated_at/provider desde nuestro meta (no del modelo). */
function coerceMeta(parsed: unknown, meta: CurateMeta): unknown {
  if (parsed && typeof parsed === "object") {
    // Solo los tres campos del contrato: meter el meta entero añadiría
    // window_hours al digest y el schema (additionalProperties: false) lo rechaza.
    return {
      ...(parsed as Record<string, unknown>),
      date: meta.date,
      generated_at: meta.generated_at,
      provider: meta.provider,
    };
  }
  return parsed;
}

function buildUserPrompt(items: NewsItem[], meta: CurateMeta): string {
  const header =
    `Datos de cabecera para el JSON de salida (cópialos tal cual):\n` +
    `- date: ${meta.date}\n- generated_at: ${meta.generated_at}\n- provider: ${meta.provider}\n\n` +
    `Ítems recogidos en las últimas ${meta.window_hours} h (${items.length}). Copia las URL LITERALMENTE.\n\n`;

  const body = items
    .map((it, i) => {
      const pts = it.points !== undefined ? ` (${it.points} pts)` : "";
      const text = collapseText(it.content || it.snippet, 600);
      const snip = text ? `\n   ${text}` : "";
      const title = collapseText(it.title, 200);
      return `${i + 1}. [${it.source}]${pts} ${title}${snip}\n   URL: ${it.url}`;
    })
    .join("\n\n");

  // El texto viene de terceros: `untrustedBlock` lo delimita para que el modelo
  // lo trate como material a resumir y no como instrucciones que pueda obedecer.
  return `${header}${untrustedBlock(body)}`;
}

function withErrors(base: string, errors: string[]): string {
  return (
    base +
    `\n\n---\nLa respuesta anterior NO fue válida. Corrige EXACTAMENTE estos problemas y responde de nuevo solo con el JSON:\n- ` +
    errors.join("\n- ")
  );
}
