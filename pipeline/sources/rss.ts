import Parser from "rss-parser";
import { fetchText } from "../http.ts";
import { warn } from "../log.ts";
import type { NewsItem, RssSource, SourcesConfig } from "../types.ts";

const parser = new Parser();

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
};

/**
 * Mapea ítems ya parseados de un feed a NewsItem[], aplicando la ventana
 * temporal y las reglas de saneado. Función pura (sin red) para poder testear
 * con fixtures reales.
 */
export function mapFeedItems(
  feedItems: FeedItem[],
  source: string,
  windowMs: number,
  now: number,
): NewsItem[] {
  const cutoff = now - windowMs;
  const items: NewsItem[] = [];

  for (const it of feedItems) {
    // Hugging Face Blog a veces omite <link>: usar guid como respaldo.
    const url = (it.link || it.guid || "").trim();
    if (!url || !/^https?:\/\//.test(url)) continue;

    const iso = it.isoDate ?? it.pubDate ?? "";
    const ts = iso ? Date.parse(iso) : NaN;
    // Descartar solo si tiene fecha válida y es anterior a la ventana.
    if (!Number.isNaN(ts) && ts < cutoff) continue;

    const title = (it.title ?? "").trim();
    if (!title) continue;

    const snippet = (it.contentSnippet ?? it.content ?? "").trim().slice(0, 500);
    const published_at = !Number.isNaN(ts) ? new Date(ts).toISOString() : new Date(now).toISOString();

    items.push({ title, snippet, url, source, published_at });
  }

  return items;
}

/** Descarga un feed RSS/Atom y devuelve sus ítems dentro de la ventana. */
export async function collectRss(src: RssSource, cfg: SourcesConfig): Promise<NewsItem[]> {
  const xml = await fetchText(src.url, cfg.timeout_ms, cfg.user_agent);
  const feed = await parser.parseString(xml);
  const items = mapFeedItems(feed.items ?? [], src.name, cfg.window_hours * 3600_000, Date.now());
  if (items.length === 0) {
    warn(`Fuente "${src.name}" sin ítems en la ventana de ${cfg.window_hours}h`);
  }
  return items;
}
