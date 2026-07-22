import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import type { Digest, Repo } from "../types.ts";
import type { Provider } from "./index.ts";

const SOCIAL_PROMPT_PATH = fileURLToPath(new URL("../../prompts/social.md", import.meta.url));
const REPOS_SOCIAL_PROMPT_PATH = fileURLToPath(new URL("../../prompts/repos-social.md", import.meta.url));
const X_LIMIT = 280;
const URL_WEIGHT = 23; // X cuenta cualquier enlace como 23 caracteres (t.co).
const POOL = 5; // Llamadas al modelo en paralelo (una por noticia / repo).

/** Convierte ASCII (letras y dígitos) a su variante Unicode "sans-serif bold". */
export function boldSans(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1d5d4 + (c - 65));
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1d5ee + (c - 97));
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1d7ec + (c - 48));
    else out += ch;
  }
  return out;
}

const cpLen = (s: string): number => [...s].length;

/** Convierte los marcadores `**texto**` en negrita Unicode (LinkedIn no renderiza markdown). */
export function applyBold(input: string): string {
  return input.replace(/\*\*(.+?)\*\*/g, (_, t) => boldSans(t));
}

/**
 * Post para X. El gancho es el post entero (texto plano, sin negrita: las letras
 * Unicode en negrita cuentan doble en X). Intenta con hashtags; si no cabe en 280
 * (contando la URL como 23) prioriza el gancho: primero suelta los hashtags, luego
 * recorta el gancho.
 */
export function assembleX(hook: string, hashtags: string[], url: string): string {
  const tags = hashtags.join(" ");
  const overhead = 1 + URL_WEIGHT; // salto de línea + URL

  let body = tags ? `${hook}\n\n${tags}` : hook;
  if (cpLen(body) + overhead > X_LIMIT) body = hook;

  if (cpLen(body) + overhead > X_LIMIT) {
    const allowed = Math.max(0, X_LIMIT - overhead - 1); // -1 por el "…"
    body = [...hook].slice(0, allowed).join("").trimEnd() + "…";
  }
  return `${body}\n${url}`;
}

/** Post para LinkedIn: sin límite práctico. El gancho abre; la idea clave marcada con `**` va en negrita. */
export function assembleLinkedIn(hook: string, hashtags: string[], url: string): string {
  const tags = hashtags.join(" ");
  const parts = [applyBold(hook)];
  if (tags) parts.push(tags);
  parts.push(url);
  return parts.join("\n\n");
}

interface SocialPost {
  hook_x?: string;
  hook_linkedin?: string;
  hashtags?: unknown;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

function buildSocialPrompt(item: Digest["items"][number]): string {
  return (
    `Noticia:\n` +
    `Titular: ${item.title}\n` +
    `Resumen: ${item.summary}\n` +
    `Por qué importa: ${item.why_it_matters}\n` +
    `Fuente: ${item.source}\n\n` +
    `Redacta los posts para X y LinkedIn siguiendo las instrucciones.`
  );
}

function buildRepoSocialPrompt(repo: Repo): string {
  const meta = [
    repo.language ? `Lenguaje: ${repo.language}` : "",
    repo.stars !== undefined ? `Estrellas: ${repo.stars}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    `Repositorio:\n` +
    `Nombre: ${repo.name}\n` +
    `Descripción: ${repo.description}\n` +
    (meta ? `${meta}\n` : "") +
    `URL: ${repo.url}\n\n` +
    `Redacta los posts para X y LinkedIn siguiendo las instrucciones.`
  );
}

/** Aplica `fn` a cada elemento en lotes de tamaño `limit` (concurrencia acotada). */
async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

function cleanHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is string => typeof h === "string")
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .filter((h) => h.length > 1)
    .slice(0, 4);
}

/**
 * Segunda tanda de llamadas al modelo (best effort), una por noticia y en
 * paralelo acotado. Rellena `item.social`; si una noticia falla se omite sin
 * afectar a las demás. Si fallan todas, la edición se publica igual sin posts.
 */
export async function attachSocial(provider: Provider, digest: Digest): Promise<void> {
  const system = readFileSync(SOCIAL_PROMPT_PATH, "utf8");
  let count = 0;

  await mapPool(digest.items, POOL, async (item) => {
    try {
      const raw = await provider.generate(system, buildSocialPrompt(item));
      const p = JSON.parse(stripFences(raw)) as SocialPost;
      const hashtags = cleanHashtags(p.hashtags);
      const hookX = (typeof p.hook_x === "string" ? p.hook_x : item.why_it_matters).trim();
      const hookLi = (typeof p.hook_linkedin === "string" ? p.hook_linkedin : item.summary).trim();
      item.social = {
        x: assembleX(hookX, hashtags, item.url),
        linkedin: assembleLinkedIn(hookLi, hashtags, item.url),
      };
      count++;
    } catch (e) {
      warn(`Posts sociales: falló la noticia rank ${item.rank}; se omite.`, String(e));
    }
  });

  log(`Posts sociales: generados para ${count}/${digest.items.length} noticias.`);
}

/**
 * Llamadas al modelo (best effort), una por repo y en paralelo acotado.
 * Rellena `repo.social`; si un repo falla se omite sin afectar a los demás.
 */
export async function attachRepoSocial(provider: Provider, digest: Digest): Promise<void> {
  const repos = digest.repos;
  if (!repos || repos.length === 0) return;

  const system = readFileSync(REPOS_SOCIAL_PROMPT_PATH, "utf8");
  let count = 0;

  await mapPool(repos, POOL, async (repo) => {
    try {
      const raw = await provider.generate(system, buildRepoSocialPrompt(repo));
      const p = JSON.parse(stripFences(raw)) as SocialPost;
      const hashtags = cleanHashtags(p.hashtags);
      const hookX = (typeof p.hook_x === "string" ? p.hook_x : repo.description).trim();
      const hookLi = (typeof p.hook_linkedin === "string" ? p.hook_linkedin : repo.description).trim();
      repo.social = {
        x: assembleX(hookX, hashtags, repo.url),
        linkedin: assembleLinkedIn(hookLi, hashtags, repo.url),
      };
      count++;
    } catch (e) {
      warn(`Posts sociales (repo): falló ${repo.name}; se omite.`, String(e));
    }
  });

  log(`Posts sociales (repos): generados para ${count}/${repos.length} repositorios.`);
}
