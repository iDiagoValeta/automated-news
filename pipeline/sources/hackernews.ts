import { fetchJson } from "../http.ts";
import { warn } from "../log.ts";
import type { HackerNewsConfig, NewsItem, SourcesConfig } from "../types.ts";

export interface AlgoliaHit {
  title?: string;
  url?: string;
  points?: number;
  created_at_i?: number;
  objectID?: string;
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
}

/**
 * Convierte un hit de Algolia en NewsItem, o null si no es publicable.
 * Función pura para probar el saneado sin red. Un hit sin titular se descarta:
 * si entrara con el hueco, el modelo podría inventarse el titular.
 */
export function hitToNewsItem(hit: AlgoliaHit): NewsItem | null {
  const link = (hit.url ?? "").trim();
  if (!link || !/^https?:\/\//.test(link)) return null; // ignora Ask/Show HN sin URL externa
  // Mismo tope de 200 que el schema y rss.ts: el titular acaba en el prompt.
  const title = (hit.title ?? "").trim().slice(0, 200);
  if (!title) return null;
  return {
    title,
    snippet: "",
    url: link,
    source: "Hacker News",
    published_at: new Date((hit.created_at_i ?? 0) * 1000).toISOString(),
    points: hit.points ?? 0,
  };
}

/**
 * Recoge historias de Hacker News vía la API de Algolia (search_by_date).
 * Lanza varias queries complementarias y deduplica por URL, quedándose con
 * la puntuación más alta observada.
 */
export async function collectHackerNews(
  cfg: SourcesConfig,
  hn: HackerNewsConfig,
): Promise<NewsItem[]> {
  const since = Math.floor((Date.now() - cfg.window_hours * 3600_000) / 1000);
  const byUrl = new Map<string, NewsItem>();

  for (const query of hn.queries) {
    const params = new URLSearchParams({
      query,
      tags: "story",
      numericFilters: `created_at_i>${since},points>=${hn.min_points}`,
      hitsPerPage: "50",
    });
    const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
    try {
      const data = await fetchJson<AlgoliaResponse>(url, cfg.timeout_ms, cfg.user_agent);
      for (const hit of data.hits ?? []) {
        const item = hitToNewsItem(hit);
        if (!item) continue;
        const existing = byUrl.get(item.url);
        if (existing) {
          if ((item.points ?? 0) > (existing.points ?? 0)) existing.points = item.points;
          continue;
        }
        byUrl.set(item.url, item);
      }
    } catch (e) {
      // Una query fallida no invalida la fuente completa.
      warn(`Hacker News: query "${query}" falló`, String(e));
    }
  }

  const items = [...byUrl.values()];
  if (items.length === 0) {
    throw new Error("Hacker News no devolvió resultados en ninguna query");
  }
  return items;
}
