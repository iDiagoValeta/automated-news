import { fetchJson } from "../http.ts";
import type { HfTrendingConfig, NewsItem, SourcesConfig } from "../types.ts";

interface HfModel {
  id?: string;
  modelId?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
}

/**
 * Modelos en tendencia del Hub de Hugging Face. Desactivado por defecto en
 * config/sources.json (aporta la sección "modelos del momento", opcional en v1).
 */
export async function collectHfTrending(
  cfg: SourcesConfig,
  hf: HfTrendingConfig,
): Promise<NewsItem[]> {
  const url = `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${hf.limit}`;
  const models = await fetchJson<HfModel[]>(url, cfg.timeout_ms, cfg.user_agent);

  return (models ?? [])
    .map((m): NewsItem | null => {
      const id = m.id ?? m.modelId ?? "";
      if (!id) return null;
      return {
        title: `Modelo en tendencia: ${id}`,
        snippet: `Descargas: ${m.downloads ?? "?"}, likes: ${m.likes ?? "?"}`,
        url: `https://huggingface.co/${id}`,
        source: "Hugging Face (trending)",
        published_at: m.lastModified ?? new Date().toISOString(),
      };
    })
    .filter((x): x is NewsItem => x !== null);
}
