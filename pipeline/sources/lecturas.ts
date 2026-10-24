import { log, warn } from "../log.ts";
import { normalize } from "../normalize.ts";
import { excludeRecentLecturas } from "../curate/lecturas.ts";
import type { LecturasConfig, NewsItem, SourcesConfig } from "../types.ts";
import { collectRss } from "./rss.ts";

/**
 * Recorta a `cap` intercalando fuentes (round robin): la más reciente de cada
 * una, luego la segunda de cada una, etc. Así una fuente de baja frecuencia no
 * pierde su única entrada frente a otra que publica decenas. Se aplica después
 * de ordenar por fecha, que es lo que hace que dentro de cada fuente la primera
 * sea la más reciente.
 */
export function roundRobinBySource(items: NewsItem[], cap: number): NewsItem[] {
  if (cap <= 0) return [];
  const queues = new Map<string, NewsItem[]>();
  for (const item of items) {
    const queue = queues.get(item.source);
    if (queue) queue.push(item);
    else queues.set(item.source, [item]);
  }

  const out: NewsItem[] = [];
  let added = true;
  while (out.length < cap && added) {
    added = false;
    for (const queue of queues.values()) {
      const next = queue.shift();
      if (!next) continue;
      out.push(next);
      added = true;
      if (out.length >= cap) break;
    }
  }
  return out;
}

/**
 * Recoge los feeds de la sección Lecturas con su propia ventana (material
 * atemporal) y los normaliza igual que las noticias: blocklist y deduplicación.
 * Las ya publicadas en la ventana reciente se quitan ANTES de aplicar el tope,
 * para que no gasten huecos, y el tope reparte por fuente. Es best effort: un
 * feed que falla se registra y se omite, y si fallan todos devuelve lista vacía
 * para que la edición salga sin sección.
 */
export async function collectLecturas(
  cfg: SourcesConfig,
  lecturas: LecturasConfig,
  recent: Set<string> = new Set(),
): Promise<NewsItem[]> {
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

  // Sin tope: primero se excluye lo ya publicado y solo después se recorta,
  // para que lo publicado no desplace candidatas frescas.
  const normalized = normalize(items, Number.MAX_SAFE_INTEGER, cfg.blocked_domains ?? []);
  const fresh = excludeRecentLecturas(normalized, recent);
  const capped = roundRobinBySource(fresh, lecturas.candidate_cap);
  const sources = new Set(capped.map((i) => i.source)).size;
  log(
    `Lecturas: ${capped.length} candidatas de ${sources} fuentes de ${fresh.length} frescas ` +
      `(${normalized.length - fresh.length} ya publicadas en la ventana reciente, ` +
      `${items.length} recogidas, ${succeeded}/${feeds.length} fuentes OK).`,
  );
  return capped;
}
