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

/**
 * Decide si se publican los repos del scraping o los de la Search API.
 * `fallback` se inyecta como función para poder probar la decisión sin red.
 * Con un parseo sano no se llama al fallback; con parseo parcial o vacío se
 * prefiere el fallback solo si devuelve más repos que el scraping, porque unos
 * parciales siguen siendo mejor que ninguno.
 */
export async function chooseTrendingResult(
  parsed: RepoRaw[],
  minAlert: number,
  fallback: () => Promise<RepoRaw[]>,
): Promise<{ repos: RepoRaw[]; source: "scraping" | "search-api" | "none" }> {
  if (!trendingParseLooksBroken(parsed.length, minAlert)) {
    return { repos: parsed, source: "scraping" };
  }
  try {
    const fromApi = await fallback();
    if (fromApi.length > parsed.length) return { repos: fromApi, source: "search-api" };
  } catch {
    // El failover es best effort: si falla, se mantiene lo que dio el scraping.
  }
  return { repos: parsed, source: parsed.length > 0 ? "scraping" : "none" };
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
  // que una alerta aquí significa markup posiblemente cambiado, no un fallo de red.
  if (!scrapeFailed && looksBroken) {
    warn(
      `GitHub trending: HTML 200 pero solo ${parsed.length} repos parseados ` +
        `(umbral ${minAlert}). El markup puede haber cambiado.`,
    );
    flagTrendingParseAlert();
  }

  const choice = await chooseTrendingResult(parsed, minAlert, async () => {
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

  if (choice.source === "search-api") {
    log(
      `GitHub trending: se usan ${choice.repos.length} repos de la Search API ` +
        `(el scraping dio ${parsed.length}).`,
    );
  } else if (looksBroken && choice.source === "scraping") {
    log(`GitHub trending: se mantienen ${choice.repos.length} repos parciales del scraping.`);
  }
  return choice.repos;
}
