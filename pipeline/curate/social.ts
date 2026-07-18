import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import type { Digest } from "../types.ts";
import type { Provider } from "./index.ts";

const SOCIAL_PROMPT_PATH = fileURLToPath(new URL("../../prompts/social.md", import.meta.url));
const X_LIMIT = 280;
const URL_WEIGHT = 23; // X cuenta cualquier enlace como 23 caracteres (t.co).

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

/**
 * Post para X. Texto plano (sin negrita) para no gastar el doble de caracteres:
 * las letras Unicode en negrita cuentan como 2 en X. Recorta el gancho y luego
 * los hashtags para caber en 280, contando la URL como 23.
 */
export function assembleX(title: string, hook: string, hashtags: string[], url: string): string {
  const tags = hashtags.join(" ");
  const overhead = 1 + URL_WEIGHT; // salto de línea + URL

  const build = (h: string, withTags: boolean): string =>
    withTags && tags ? `${title}\n\n${h}\n\n${tags}` : `${title}\n\n${h}`;

  let body = build(hook, true);
  if (cpLen(body) + overhead > X_LIMIT) body = build(hook, false);

  if (cpLen(body) + overhead > X_LIMIT) {
    const fixed = cpLen(`${title}\n\n`) + overhead + 1; // +1 por el "…"
    const allowed = Math.max(0, X_LIMIT - fixed);
    const trimmed = [...hook].slice(0, allowed).join("").trimEnd() + "…";
    body = `${title}\n\n${trimmed}`;
  }
  return `${body}\n${url}`;
}

/** Post para LinkedIn: sin límite práctico, con el titular en negrita. */
export function assembleLinkedIn(title: string, hook: string, hashtags: string[], url: string): string {
  const tags = hashtags.join(" ");
  const parts = [boldSans(title), hook];
  if (tags) parts.push(tags);
  parts.push(url);
  return parts.join("\n\n");
}

interface SocialPost {
  rank?: number;
  hook_x?: string;
  hook_linkedin?: string;
  hashtags?: unknown;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

function buildSocialPrompt(digest: Digest): string {
  const header = `Noticias de la edición ${digest.date}. Genera los posts para cada una:\n\n`;
  const body = digest.items
    .map(
      (it) =>
        `${it.rank}. [${it.category}] ${it.title}\n   ${it.summary}\n   Por qué importa: ${it.why_it_matters}\n   Fuente: ${it.source}`,
    )
    .join("\n\n");
  return header + body;
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
 * Segunda llamada al modelo (best effort). Rellena `item.social` en cada
 * noticia. Si falla, la edición se publica igual sin posts sociales.
 */
export async function attachSocial(provider: Provider, digest: Digest): Promise<void> {
  try {
    const system = readFileSync(SOCIAL_PROMPT_PATH, "utf8");
    const raw = await provider.generate(system, buildSocialPrompt(digest));
    const parsed = JSON.parse(stripFences(raw)) as { posts?: SocialPost[] };
    const posts = parsed.posts ?? [];
    const byRank = new Map<number, SocialPost>();
    for (const p of posts) if (typeof p.rank === "number") byRank.set(p.rank, p);

    let count = 0;
    for (const item of digest.items) {
      const p = byRank.get(item.rank);
      if (!p) continue;
      const hashtags = cleanHashtags(p.hashtags);
      const hookX = (p.hook_x ?? item.why_it_matters).trim();
      const hookLi = (p.hook_linkedin ?? item.summary).trim();
      item.social = {
        x: assembleX(item.title, hookX, hashtags, item.url),
        linkedin: assembleLinkedIn(item.title, hookLi, hashtags, item.url),
      };
      count++;
    }
    log(`Posts sociales: generados para ${count}/${digest.items.length} noticias.`);
  } catch (e) {
    warn("No se pudieron generar los posts sociales; la edición se publica sin ellos.", String(e));
  }
}
