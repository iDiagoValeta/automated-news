import { appendFileSync } from "node:fs";
import { fetchText, fetchWithTimeout } from "../http.ts";
import { log, warn } from "../log.ts";
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
export async function searchApiFallback(
  cfg: Pick<SourcesConfig, "user_agent" | "timeout_ms">,
  gh: Pick<GithubTrendingConfig, "limit">,
): Promise<RepoRaw[]> {
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

  // El cuerpo se lee dentro de fetchWithTimeout; si no, la Search API podría
  // dejar la recogida colgada después de mandar las cabeceras.
  const data = await fetchWithTimeout(
    url,
    cfg.timeout_ms,
    { headers },
    async (res) => {
      if (!res.ok) throw new Error(`Search API HTTP ${res.status}`);
      return (await res.json()) as { items?: SearchRepo[] };
    },
  );

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
}

export interface TrendingSelection {
  repos: RepoRaw[];
  /** Cuántos de los repos finales vienen del scraping. */
  parsedCount: number;
  /** Cuántos de los repos finales vienen de la Search API. */
  apiCount: number;
}

/**
 * Con un parseo por debajo del umbral no se elige una vía: se combinan, primero
 * los del scraping y después los de la API que no estén ya (dedupe por `name`),
 * hasta `limit`. Elegir por recuento bruto antes de `excludeRecentRepos` podía
 * dejar la sección vacía: la ventana de la API coincide con la de exclusión y
 * devuelve repos ya publicados, mientras que los parciales del scraping son
 * frescos. `fallback` se inyecta como función para probar la decisión sin red.
 */
export async function combineTrendingResult(
  parsed: RepoRaw[],
  minAlert: number,
  limit: number,
  fallback: () => Promise<RepoRaw[]>,
): Promise<TrendingSelection> {
  if (!trendingParseLooksBroken(parsed.length, minAlert)) {
    return { repos: parsed, parsedCount: parsed.length, apiCount: 0 };
  }

  const repos = parsed.slice(0, limit);
  const seen = new Set(repos.map((r) => r.name));
  let apiCount = 0;
  try {
    for (const r of await fallback()) {
      if (repos.length >= limit) break;
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      repos.push(r);
      apiCount++;
    }
  } catch {
    // El failover es best effort: si falla, se mantiene lo que dio el scraping.
  }
  return { repos, parsedCount: repos.length - apiCount, apiCount };
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
  let parsed: RepoRaw[] = [];
  let scrapeFailed = false;
  try {
    const html = await fetchText(url, cfg.timeout_ms, cfg.user_agent);
    parsed = parseTrending(html, gh.limit);
  } catch (e) {
    scrapeFailed = true;
    warn("GitHub trending (scraping) falló; se intenta la Search API.", String(e));
  }

  const looksBroken = trendingParseLooksBroken(parsed.length, minAlert);
  // fetchText solo devuelve el cuerpo si el status fue 200 (u otro 2xx), así
  // que un aviso aquí significa markup posiblemente cambiado, no un fallo de red.
  if (!scrapeFailed && looksBroken) {
    warn(
      `GitHub trending: HTML 200 pero solo ${parsed.length} repos parseados ` +
        `(umbral ${minAlert}). El markup puede haber cambiado.`,
    );
  }

  const selection = await combineTrendingResult(parsed, minAlert, gh.limit, async () => {
    try {
      return await searchApiFallback(cfg, gh);
    } catch (e) {
      warn(
        parsed.length > 0
          ? "GitHub Search API también falló; se usan los repos parciales del scraping."
          : "GitHub Search API también falló; la edición irá sin repos.",
        String(e),
      );
      throw e;
    }
  });

  // Con HTML 200 y cero repos el parser está roto aunque la API rescate la
  // sección, así que se avisa siempre. Con parseo parcial solo se avisa si la
  // combinación final no llega al umbral. Un fallo de red no dice nada del
  // parser y no abre issue de parseo.
  if (
    !scrapeFailed &&
    (parsed.length === 0 || (looksBroken && selection.repos.length < minAlert))
  ) {
    flagTrendingParseAlert();
  }

  if (selection.repos.length === 0) {
    warn("GitHub trending: ni el scraping ni la Search API dieron repos; la edición irá sin sección.");
  } else if (looksBroken) {
    log(
      `GitHub trending: ${selection.repos.length} repos ` +
        `(${selection.parsedCount} del scraping, ${selection.apiCount} de la Search API).`,
    );
  }
  return selection.repos;
}
