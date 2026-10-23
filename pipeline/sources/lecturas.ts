import { log, warn } from "../log.ts";
import { normalize } from "../normalize.ts";
import type { LecturasConfig, NewsItem, SourcesConfig } from "../types.ts";
import { collectRss } from "./rss.ts";

/**
 * Recoge los feeds de la sección Lecturas con su propia ventana (material
 * atemporal) y los normaliza igual que las noticias: cap, blocklist y
 * deduplicación. Es best effort: un feed que falla se registra y se omite, y
 * si fallan todos devuelve lista vacía para que la edición salga sin sección.
 */
export async function collectLecturas(cfg: SourcesConfig, lecturas: LecturasConfig): Promise<NewsItem[]> {
  const feeds = lecturas.feeds.filter((f) => f.enabled);
  if (feeds.length === 0) return [];

  const settled = await Promise.allSettled(
    feeds.map((feed) => collectRss(feed, cfg, lecturas.window_hours)),
  );

  const items: NewsItem[] = [];
  let succeeded = 0;
  settled.forEach((res, i) => {
    const feed = feeds[i];
    if (res.status === "fulfilled") {
      succeeded++;
      items.push(...res.value);
      log(`Lecturas "${feed.name}": ${res.value.length} ítems`);
    } else {
      const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
      warn(`Lecturas "${feed.name}" falló (se omite)`, reason);
    }
  });

  const normalized = normalize(items, lecturas.candidate_cap, cfg.blocked_domains ?? []);
  log(
    `Lecturas: ${normalized.length} candidatas normalizadas de ${items.length} recogidas ` +
      `(${succeeded}/${feeds.length} fuentes OK).`,
  );
  return normalized;
}
