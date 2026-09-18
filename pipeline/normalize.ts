import { log, warn } from "./log.ts";
import type { NewsItem } from "./types.ts";

/** Hostname en minúsculas, o cadena vacía si la URL no parsea. */
export function hostnameOf(raw: string): string {
  try {
    return new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * ¿El host está en la blocklist? Coincide el dominio exacto y cualquier
 * subdominio (canews24.online también cubre www.canews24.online).
 */
export function isBlockedHost(host: string, blocked: string[]): boolean {
  if (!host || blocked.length === 0) return false;
  return blocked.some((raw) => {
    const domain = raw.trim().toLowerCase().replace(/^\./, "");
    if (!domain) return false;
    return host === domain || host.endsWith(`.${domain}`);
  });
}

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
 * Descarta dominios de `blocked` (agregadores / rehosts) antes de deduplicar.
 */
export function normalize(items: NewsItem[], cap = 120, blocked: string[] = []): NewsItem[] {
  const hnDest = new Map<string, number>();
  const byUrl = new Map<string, NewsItem>();

  for (const item of items) {
    const host = hostnameOf(item.url);
    if (item.source === "Hacker News" && host) {
      hnDest.set(host, (hnDest.get(host) ?? 0) + 1);
    }
    if (isBlockedHost(host, blocked)) {
      warn(`Normalización: descartado ${host} (blocklist)`, item.url);
      continue;
    }
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

  if (hnDest.size > 0) {
    const summary = [...hnDest.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([h, n]) => (n > 1 ? `${h}×${n}` : h))
      .join(", ");
    log(`Hacker News: news.ycombinator.com -> ${summary}`);
  }

  const deduped = [...byUrl.values()];
  deduped.sort((a, b) => {
    const p = (b.points ?? 0) - (a.points ?? 0);
    if (p !== 0) return p;
    return Date.parse(b.published_at) - Date.parse(a.published_at);
  });

  return deduped.slice(0, cap);
}
