import { test } from "node:test";
import assert from "node:assert/strict";
import Parser from "rss-parser";
import {
  absoluteUrl,
  buildAtom,
  buildRobots,
  buildRss,
  buildSitemap,
  escapeXml,
  staticPagePaths,
} from "../../site/_11ty/feeds.js";
import { addDays, buildWeek } from "../../site/_11ty/semana.js";
import { buildSearchIndex, searchDocs } from "../../site/_11ty/search.js";

const site = {
  title: "La Terminal",
  url: "https://idiagovaleta.github.io/automated-news",
  descripcion: "Diario estático de noticias de tecnología.",
};

function edition(date, over = {}) {
  return {
    date,
    generated_at: `${date}T12:00:00.000Z`,
    path: `/${date.replace(/-/g, "/")}/`,
    year: date.slice(0, 4),
    month: date.slice(5, 7),
    day: date.slice(8, 10),
    items: [
      {
        rank: 1,
        category: "lanzamientos",
        title: `Titular de ${date} con A&B`,
        summary: "Resumen de la noticia principal.",
        why_it_matters: "Por qué importa.",
        url: `https://example.com/${date}`,
        source: "The Verge",
      },
      {
        rank: 2,
        category: "herramientas",
        title: "Otra pieza",
        summary: "Texto secundario.",
        why_it_matters: "Contexto.",
        url: `https://example.com/${date}/b`,
        source: "Ars Technica",
      },
    ],
    repos: [
      {
        name: `acme/tool-${date}`,
        url: `https://github.com/acme/tool-${date}`,
        description: "Utilidad práctica.",
        language: "TypeScript",
      },
    ],
    ...over,
  };
}

test("escapeXml cubre los cinco caracteres especiales", () => {
  assert.equal(escapeXml(`A&B <x> "y" 'z'`), "A&amp;B &lt;x&gt; &quot;y&quot; &apos;z&apos;");
});

test("absoluteUrl respeta el pathPrefix embebido en site.url", () => {
  assert.equal(absoluteUrl(site.url, "/"), `${site.url}/`);
  assert.equal(absoluteUrl(site.url, "/2026/09/18/"), `${site.url}/2026/09/18/`);
});

test("RSS y Atom son XML bien formados y parseables", async () => {
  const editions = [edition("2026-09-18"), edition("2026-09-17")];
  const rss = buildRss({ site, editions });
  const atom = buildAtom({ site, editions });
  assert.match(rss, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(atom, /xmlns="http:\/\/www.w3.org\/2005\/Atom"/);
  assert.match(rss, /A&amp;B/);
  assert.doesNotMatch(rss, /A&B/);

  const parser = new Parser();
  const rssFeed = await parser.parseString(rss);
  const atomFeed = await parser.parseString(atom);
  assert.equal(rssFeed.items.length, 2);
  assert.equal(atomFeed.items.length, 2);
  assert.ok(rssFeed.items[0].title.includes("2026-09-18"));
  assert.ok((rssFeed.items[0].contentSnippet || rssFeed.items[0].content || "").includes("Titular"));
});

test("sitemap y robots apuntan a la URL de GitHub Pages", () => {
  const editions = [edition("2026-09-18")];
  const xml = buildSitemap(site.url, staticPagePaths(editions));
  assert.match(xml, /<urlset /);
  assert.match(xml, /https:\/\/idiagovaleta.github.io\/automated-news\/$/m);
  assert.match(xml, /\/2026\/09\/18\//);
  assert.match(xml, /\/semana\//);
  assert.match(xml, /\/archivo\/buscar\//);
  const robots = buildRobots(`${site.url}/sitemap.xml`);
  assert.match(robots, /Sitemap: https:\/\/idiagovaleta.github.io\/automated-news\/sitemap.xml/);
});

test("buildWeek toma la ventana de 7 días y el rank 1 de cada día", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  const editions = [
    edition("2026-09-18"),
    edition("2026-09-16"),
    edition("2026-09-10"), // fuera de ventana (18-6 = 12)
  ];
  const week = buildWeek(editions, 7);
  assert.equal(week.from, "2026-09-12");
  assert.equal(week.to, "2026-09-18");
  assert.equal(week.editions.length, 2);
  assert.equal(week.tops.length, 2);
  assert.ok(week.tops[0].item.title.includes("2026-09-18"));
  assert.ok(week.categories.some((c) => c.id === "lanzamientos"));
  assert.ok(week.repos.some((r) => r.name.startsWith("acme/tool-")));
});

test("searchDocs encuentra por palabras del titular", () => {
  const editions = [edition("2026-09-18"), edition("2026-09-17")];
  const index = buildSearchIndex(editions);
  const hits = searchDocs(index, "titular A&B");
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].title.includes("2026-09-18"));
  assert.equal(searchDocs(index, "zzznoexiste").length, 0);
});
