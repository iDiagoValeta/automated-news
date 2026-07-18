import { log, warn } from "./log.ts";
import type { NewsItem, SourcesConfig } from "./types.ts";

// Enriquecimiento: para los candidatos con más señal, descarga la página y
// extrae texto real (meta descripción + primeros párrafos), de modo que el
// resumen no dependa solo del titular. Tolerante a fallos, paywalls y bloqueos.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

/** Extrae un texto legible del HTML: meta descripción + primeros párrafos. */
export function extractReadable(html: string, maxChars = 1200): string {
  const desc = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ]);

  const paras: string[] = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && paras.length < 8) {
    const text = stripTags(m[1]);
    if (text.length >= 60) paras.push(text);
  }

  const parts: string[] = [];
  if (desc) parts.push(desc);
  parts.push(...paras);
  return parts.join(" ").slice(0, maxChars).trim();
}

async function fetchArticle(url: string, timeoutMs: number, userAgent: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return null;
    const html = await res.text();
    const text = extractReadable(html);
    return text.length >= 80 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Enriquece in situ los primeros `enrich_top` ítems (ya ordenados por señal). */
export async function enrich(items: NewsItem[], cfg: SourcesConfig): Promise<void> {
  const targets = items.slice(0, cfg.enrich_top);
  const concurrency = 6;
  let index = 0;
  let ok = 0;

  async function worker(): Promise<void> {
    while (index < targets.length) {
      const item = targets[index++];
      const text = await fetchArticle(item.url, cfg.enrich_timeout_ms, cfg.user_agent);
      if (text) {
        item.content = text;
        ok++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  log(`Enriquecimiento: ${ok}/${targets.length} artículos leídos con éxito.`);
  if (ok === 0) warn("Enriquecimiento: ningún artículo pudo leerse; se usa el snippet del feed.");
}
