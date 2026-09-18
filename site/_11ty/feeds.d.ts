export function escapeXml(value: unknown): string;
export function siteOrigin(siteUrl: string): string;
export function absoluteUrl(siteUrl: string, pageUrl?: string): string;
export function buildRss(opts: {
  site: { title: string; url: string; descripcion: string };
  editions: unknown[];
  limit?: number;
}): string;
export function buildAtom(opts: {
  site: { title: string; url: string; descripcion: string };
  editions: unknown[];
  limit?: number;
}): string;
export function staticPagePaths(editions?: Array<Record<string, unknown>>): string[];
export function buildSitemap(siteUrl: string, paths: string[]): string;
export function buildRobots(sitemapUrl: string): string;
