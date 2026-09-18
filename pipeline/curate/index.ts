import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import { dropInventedUrlItems, validateDigest } from "../validate.ts";
import type { Digest, NewsItem, ProviderName, RepoRaw } from "../types.ts";
import { deepseekProvider } from "./deepseek.ts";
import { claudeCodeProvider } from "./claude-code.ts";
import { attachRepoSocial, attachSocial } from "./social.ts";
import { attachRepos } from "./repos.ts";

/** Repos en tendencia y cuántos elegir; se resuelven fuera (best effort). */
export interface ReposInput {
  trending: RepoRaw[];
  pick: number;
}

const PROMPT_PATH = fileURLToPath(new URL("../../prompts/curacion.md", import.meta.url));
const MAX_ATTEMPTS = 3; // 1 intento + hasta 2 reintentos

export interface Provider {
  name: ProviderName;
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface CurateMeta {
  date: string;
  generated_at: string;
  provider: ProviderName;
}

export function resolveProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "deepseek").toLowerCase();
  if (raw === "claude-code") return "claude-code";
  return "deepseek";
}

/** ¿Está presente la credencial del proveedor? Permite saltar sin fallar. */
export function providerCredentialPresent(name: ProviderName): boolean {
  if (name === "claude-code") return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function getProvider(name: ProviderName): Provider {
  return name === "claude-code" ? claudeCodeProvider() : deepseekProvider();
}

/** El otro proveedor del par deepseek / claude-code. */
export function alternateProviderName(name: ProviderName): ProviderName {
  return name === "deepseek" ? "claude-code" : "deepseek";
}

/**
 * Cadena de proveedores: el principal y, si hay credencial, el alternativo
 * para failover automático.
 */
export function resolveProviderChain(primary: ProviderName): Provider[] {
  const chain: Provider[] = [getProvider(primary)];
  const alt = alternateProviderName(primary);
  if (providerCredentialPresent(alt)) chain.push(getProvider(alt));
  return chain;
}

type CurateOutcome = { ok: true; digest: Digest } | { ok: false; errors: string[] };

/**
 * Paso 3 del pipeline. Llama al LLM configurado, valida la salida contra el
 * schema + comprobación de URLs, y reintenta hasta 2 veces. Un error de red
 * en generate() consume intento (se reintenta con el prompt base). Un fallo
 * de JSON/schema inyecta el error en el prompt. Si el proveedor principal
 * agota los intentos, se prueba el alternativo cuando su credencial está
 * presente. Lanza si tras toda la cadena sigue sin validar.
 *
 * `providers` permite inyectar mocks en tests; si se omite, se resuelve
 * desde el entorno.
 */
export async function curate(
  items: NewsItem[],
  meta: CurateMeta,
  repos?: ReposInput,
  providers?: Provider[],
): Promise<Digest> {
  const chain = providers ?? resolveProviderChain(meta.provider);
  if (chain.length === 0) {
    throw new Error("No hay proveedores LLM disponibles para curar.");
  }

  let lastErrors: string[] = ["desconocido"];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    if (i > 0) {
      log(`Failover: se reintenta la curación con ${provider.name} tras fallar ${chain[i - 1].name}.`);
    }
    const attemptMeta: CurateMeta = { ...meta, provider: provider.name };
    const outcome = await curateWithProvider(items, attemptMeta, provider, repos);
    if (outcome.ok) return outcome.digest;
    lastErrors = outcome.errors;
  }

  throw new Error(
    `Curación falló tras ${MAX_ATTEMPTS} intentos con ${chain.map((p) => p.name).join(", ")}. ` +
      `Últimos errores: ${lastErrors.join(" | ")}`,
  );
}

async function curateWithProvider(
  items: NewsItem[],
  meta: CurateMeta,
  provider: Provider,
  repos?: ReposInput,
): Promise<CurateOutcome> {
  const systemPrompt = readFileSync(PROMPT_PATH, "utf8");
  const inputUrls = new Set(items.map((i) => i.url));
  const baseUserPrompt = buildUserPrompt(items, meta);

  let userPrompt = baseUserPrompt;
  let lastErrors: string[] = ["desconocido"];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await provider.generate(systemPrompt, userPrompt);
    } catch (e) {
      lastErrors = [`Error de red o de proveedor: ${String(e)}`];
      warn(`Intento ${attempt}: generate() falló`, String(e));
      // La red no produjo JSON: reintentar con el prompt base, no con el error.
      userPrompt = baseUserPrompt;
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
      return { ok: true, digest: valid };
    }

    lastErrors = result.errors;
    warn(`Intento ${attempt}: validación falló`, lastErrors);
    userPrompt = withErrors(baseUserPrompt, lastErrors);
  }

  return { ok: false, errors: lastErrors };
}

/** Forzamos date/generated_at/provider desde nuestro meta (no del modelo). */
function coerceMeta(parsed: unknown, meta: CurateMeta): unknown {
  if (parsed && typeof parsed === "object") {
    return { ...(parsed as Record<string, unknown>), ...meta };
  }
  return parsed;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

function buildUserPrompt(items: NewsItem[], meta: CurateMeta): string {
  const header =
    `Datos de cabecera para el JSON de salida (cópialos tal cual):\n` +
    `- date: ${meta.date}\n- generated_at: ${meta.generated_at}\n- provider: ${meta.provider}\n\n` +
    `Ítems recogidos en las últimas 24 h (${items.length}). Copia las URL LITERALMENTE:\n\n`;

  const body = items
    .map((it, i) => {
      const pts = it.points !== undefined ? ` (${it.points} pts)` : "";
      const text = (it.content || it.snippet).replace(/\s+/g, " ").slice(0, 600);
      const snip = text ? `\n   ${text}` : "";
      return `${i + 1}. [${it.source}]${pts} ${it.title}${snip}\n   URL: ${it.url}`;
    })
    .join("\n\n");

  return header + body;
}

function withErrors(base: string, errors: string[]): string {
  return (
    base +
    `\n\n---\nLa respuesta anterior NO fue válida. Corrige EXACTAMENTE estos problemas y responde de nuevo solo con el JSON:\n- ` +
    errors.join("\n- ")
  );
}
