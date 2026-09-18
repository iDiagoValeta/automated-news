import { appendFileSync } from "node:fs";
import { fetchText } from "../http.ts";
import { warn } from "../log.ts";
import type { GithubTrendingConfig, RepoRaw, SourcesConfig } from "../types.ts";

/** Umbral por defecto: por debajo, el HTML 200 se considera markup roto. */
export const TRENDING_PARSE_ALERT_MIN = 5;

/** ¿El recuento parseado es demasiado bajo para un HTML de trending válido? */
export function trendingParseLooksBroken(
  parsedCount: number,
  minCount = TRENDING_PARSE_ALERT_MIN,
): boolean {
  return parsedCount < minCount;
}

/**
 * Marca la salida del step de Actions para que el workflow abra un issue.
 * Fuera de GitHub Actions no hace nada.
 */
export function flagTrendingParseAlert(): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  try {
    appendFileSync(out, "trending_parse_alert=true\n");
  } catch (e) {
    warn("No se pudo escribir GITHUB_OUTPUT para la alerta de trending.", String(e));
  }
}

/** Quita etiquetas HTML y decodifica las entidades más comunes. */
function stripHtml(s: string): string {
  const text = s.replace(/<[^>]+>/g, "");
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea la página github.com/trending. Cada repo es un `<article class="Box-row">`.
 * Extrae owner/repo, descripción, lenguaje y estrellas (totales y del periodo).
 */
export function parseTrending(html: string, limit: number): RepoRaw[] {
  const repos: RepoRaw[] = [];
  const blocks = html.split('<article class="Box-row">').slice(1);

  for (const block of blocks) {
    const end = block.indexOf("</article>");
    const a = end >= 0 ? block.slice(0, end) : block;

    const nameM = a.match(/<h2[^>]*>[\s\S]*?href="\/([^"]+)"/);
    if (!nameM) continue;
    const name = nameM[1];

    const descM = a.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descM ? stripHtml(descM[1]) : "";

    const langM = a.match(/programmingLanguage"[^>]*>([^<]+)</);
    const language = langM ? langM[1].trim() : "";

    const starsM = a.match(/\/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/);
    const stars = starsM ? Number(starsM[1].replace(/,/g, "")) : 0;

    const todayM = a.match(/([\d,]+)\s*stars?\s*(?:today|this week|this month)/i);
    const stars_today = todayM ? Number(todayM[1].replace(/,/g, "")) : 0;

    repos.push({ name, url: `https://github.com/${name}`, description, language, stars, stars_today });
    if (repos.length >= limit) break;
  }

  return repos;
}

interface SearchRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
}

/**
 * Fallback oficial cuando el scraping de trending falla: repos creados en la
 * última semana ordenados por estrellas. Usa GITHUB_TOKEN si está disponible
 * (mayor límite de peticiones en GitHub Actions).
 */
async function searchApiFallback(cfg: SourcesConfig, gh: GithubTrendingConfig): Promise<RepoRaw[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url =
    `https://api.github.com/search/repositories?q=created:>${since}` +
    `&sort=stars&order=desc&per_page=${gh.limit}`;

  const headers: Record<string, string> = {
    "User-Agent": cfg.user_agent,
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout_ms);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`Search API HTTP ${res.status}`);
    const data = (await res.json()) as { items?: SearchRepo[] };
    return (data.items ?? [])
      .filter((r): r is SearchRepo & { full_name: string } => typeof r.full_name === "string")
      .map((r) => ({
        name: r.full_name,
        url: r.html_url ?? `https://github.com/${r.full_name}`,
        description: r.description ?? "",
        language: r.language ?? "",
        stars: r.stargazers_count ?? 0,
        stars_today: 0,
      }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recoge repositorios en tendencia de GitHub. Best effort: intenta el scraping
 * de la página de trending y, si falla, cae a la Search API oficial. Si todo
 * falla devuelve una lista vacía (la sección simplemente no aparece).
 */
export async function collectGithubTrending(
  cfg: SourcesConfig,
  gh: GithubTrendingConfig,
): Promise<RepoRaw[]> {
  const url = `https://github.com/trending?since=${gh.since}`;
  const minAlert = gh.min_parse_alert ?? TRENDING_PARSE_ALERT_MIN;
  try {
    const html = await fetchText(url, cfg.timeout_ms, cfg.user_agent);
    const repos = parseTrending(html, gh.limit);
    // fetchText solo devuelve el cuerpo si el status fue 200 (u otro 2xx).
    if (trendingParseLooksBroken(repos.length, minAlert)) {
      warn(
        `GitHub trending: HTML 200 pero solo ${repos.length} repos parseados ` +
          `(umbral ${minAlert}). El markup puede haber cambiado.`,
      );
      flagTrendingParseAlert();
    }
    if (repos.length > 0) return repos;
    throw new Error("trending sin resultados parseables");
  } catch (e) {
    warn("GitHub trending (scraping) falló; se intenta la Search API.", String(e));
    try {
      return await searchApiFallback(cfg, gh);
    } catch (e2) {
      warn("GitHub Search API también falló; la edición irá sin repos.", String(e2));
      return [];
    }
  }
}
