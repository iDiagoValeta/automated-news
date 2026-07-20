import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import { dropInventedUrlItems, validateDigest } from "../validate.ts";
import type { Digest, NewsItem, ProviderName, RepoRaw } from "../types.ts";
import { deepseekProvider } from "./deepseek.ts";
import { claudeCodeProvider } from "./claude-code.ts";
import { attachSocial } from "./social.ts";
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

/**
 * Paso 3 del pipeline. Llama al LLM configurado, valida la salida contra el
 * schema + comprobación de URLs, y reintenta hasta 2 veces inyectando el error
 * concreto en el prompt. Lanza si tras los reintentos sigue sin validar.
 */
export async function curate(items: NewsItem[], meta: CurateMeta, repos?: ReposInput): Promise<Digest> {
  const provider = getProvider(meta.provider);
  const systemPrompt = readFileSync(PROMPT_PATH, "utf8");
  const inputUrls = new Set(items.map((i) => i.url));
  const baseUserPrompt = buildUserPrompt(items, meta);

  let userPrompt = baseUserPrompt;
  let lastErrors: string[] = ["desconocido"];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await provider.generate(systemPrompt, userPrompt);
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
      }
      return valid;
    }

    lastErrors = result.errors;
    warn(`Intento ${attempt}: validación falló`, lastErrors);
    userPrompt = withErrors(baseUserPrompt, lastErrors);
  }

  throw new Error(`Curación falló tras ${MAX_ATTEMPTS} intentos. Últimos errores: ${lastErrors.join(" | ")}`);
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
