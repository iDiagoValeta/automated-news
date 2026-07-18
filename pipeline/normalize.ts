import type { NewsItem } from "./types.ts";

/**
 * Canonicaliza una URL para deduplicar: quita el fragmento (#...), los
 * parámetros de tracking (utm_*, ref, fbclid) y la barra final. Es una
 * deduplicación "básica" por URL.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    const drop: string[] = [];
    u.searchParams.forEach((_, key) => {
      if (/^utm_/i.test(key) || key === "ref" || key === "fbclid") drop.push(key);
    });
    for (const key of drop) u.searchParams.delete(key);
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/**
 * Deduplica por URL canónica y ordena por señal (puntos de HN primero, luego
 * fecha). Cuando dos ítems colisionan, se conserva el primero pero se hereda
 * la mayor puntuación disponible. Limita el total para acotar el prompt.
 */
export function normalize(items: NewsItem[], cap = 120): NewsItem[] {
  const byUrl = new Map<string, NewsItem>();

  for (const item of items) {
    const key = canonicalUrl(item.url);
    if (!key) continue;
    const existing = byUrl.get(key);
    if (existing) {
      if ((item.points ?? 0) > (existing.points ?? 0)) existing.points = item.points;
      if (!existing.snippet && item.snippet) existing.snippet = item.snippet;
      continue;
    }
    byUrl.set(key, { ...item, url: key });
  }

  const deduped = [...byUrl.values()];
  deduped.sort((a, b) => {
    const p = (b.points ?? 0) - (a.points ?? 0);
    if (p !== 0) return p;
    return Date.parse(b.published_at) - Date.parse(a.published_at);
  });

  return deduped.slice(0, cap);
}
