import { fetchJson } from "../http.ts";
import { warn } from "../log.ts";
import type { HackerNewsConfig, NewsItem, SourcesConfig } from "../types.ts";

interface AlgoliaHit {
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
        const link = (hit.url ?? "").trim();
        if (!link || !/^https?:\/\//.test(link)) continue; // ignora Ask/Show HN sin URL externa
        const existing = byUrl.get(link);
        if (existing) {
          if ((hit.points ?? 0) > (existing.points ?? 0)) existing.points = hit.points;
          continue;
        }
        byUrl.set(link, {
          title: (hit.title ?? "").trim(),
          snippet: "",
          url: link,
          source: "Hacker News",
          published_at: new Date((hit.created_at_i ?? 0) * 1000).toISOString(),
          points: hit.points ?? 0,
        });
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
