/** Helpers de XML y URLs absolutas para feeds, sitemap y robots. */

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function siteOrigin(siteUrl) {
  return String(siteUrl || "").replace(/\/$/, "");
}

/** Une la URL base del sitio (con pathPrefix) y una ruta de Eleventy (`page.url`). */
export function absoluteUrl(siteUrl, pageUrl) {
  const base = siteOrigin(siteUrl);
  if (!pageUrl || pageUrl === "/" || pageUrl === "/index.html") return `${base}/`;
  const path = pageUrl.startsWith("/") ? pageUrl : `/${pageUrl}`;
  return `${base}${path}`;
}

function rfc822(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

function editionBody(edition) {
  const lines = (edition.items || []).map((it, i) => {
    const n = i + 1;
    const why = it.why_it_matters ? `\nPor qué importa: ${it.why_it_matters}` : "";
    return `${n}. ${it.title}\n${it.summary || ""}${why}\nFuente: ${it.source}\n${it.url}`;
  });
  return lines.join("\n\n");
}

/**
 * RSS 2.0: un ítem por edición reciente. La más nueva lleva el texto completo
 * de todas sus noticias.
 */
export function buildRss({ site, editions, limit = 14 }) {
  const origin = siteOrigin(site.url);
  const self = `${origin}/feed.xml`;
  const items = (editions || []).slice(0, limit);
  const itemXml = items
    .map((e) => {
      const link = absoluteUrl(site.url, e.path);
      const title = `Edición ${e.date}`;
      const desc = editionBody(e);
      const pub = rfc822(e.generated_at || `${e.date}T12:00:00Z`);
      return [
        "    <item>",
        `      <title>${escapeXml(title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${escapeXml(pub)}</pubDate>`,
        `      <description>${escapeXml(desc)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(site.title)}</title>`,
    `    <link>${escapeXml(origin + "/")}</link>`,
    `    <description>${escapeXml(site.descripcion)}</description>`,
    "    <language>es-ES</language>",
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>`,
    itemXml,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Atom 1.0 paralelo al RSS, misma ventana de ediciones. */
export function buildAtom({ site, editions, limit = 14 }) {
  const origin = siteOrigin(site.url);
  const self = `${origin}/atom.xml`;
  const items = (editions || []).slice(0, limit);
  const updated = items[0]?.generated_at || items[0]?.date || new Date().toISOString();
  const entryXml = items
    .map((e) => {
      const link = absoluteUrl(site.url, e.path);
      const title = `Edición ${e.date}`;
      const desc = editionBody(e);
      const when = e.generated_at || `${e.date}T12:00:00Z`;
      return [
        "  <entry>",
        `    <title>${escapeXml(title)}</title>`,
        `    <link href="${escapeXml(link)}" rel="alternate"/>`,
        `    <id>${escapeXml(link)}</id>`,
        `    <updated>${escapeXml(when)}</updated>`,
        `    <summary type="text">${escapeXml(desc)}</summary>`,
        "  </entry>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(site.title)}</title>`,
    `  <subtitle>${escapeXml(site.descripcion)}</subtitle>`,
    `  <link href="${escapeXml(origin + "/")}" rel="alternate"/>`,
    `  <link href="${escapeXml(self)}" rel="self"/>`,
    `  <id>${escapeXml(origin + "/")}</id>`,
    `  <updated>${escapeXml(updated)}</updated>`,
    entryXml,
    "</feed>",
    "",
  ].join("\n");
}

export function staticPagePaths(editions = []) {
  const pages = [
    "/",
    "/repositorios/",
    "/semana/",
    "/archivo/",
    "/archivo/noticias/",
    "/archivo/repositorios/",
    "/archivo/buscar/",
  ];
  for (const e of editions) {
    if (e.path) pages.push(e.path);
    if (Array.isArray(e.repos) && e.repos.length > 0 && e.year) {
      pages.push(`/repositorios/${e.year}/${e.month}/${e.day}/`);
    }
  }
  return [...new Set(pages)];
}

export function buildSitemap(siteUrl, paths) {
  const urls = (paths || []).map((p) => {
    const loc = absoluteUrl(siteUrl, p);
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function buildRobots(sitemapUrl) {
  return ["User-agent: *", "Allow: /", `Sitemap: ${sitemapUrl}`, ""].join("\n");
}
