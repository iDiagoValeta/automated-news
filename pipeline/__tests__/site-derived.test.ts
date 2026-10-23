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
  rfc822,
  staticPagePaths,
} from "../../site/_11ty/feeds.js";
import { addDays, buildWeek } from "../../site/_11ty/semana.js";
import { buildSearchIndex, searchDocs } from "../../site/_11ty/search.js";
import { lecturasPagePath, temaLabel } from "../../site/_11ty/lecturas.js";

const site = {
  title: "La Terminal",
  url: "https://idiagovaleta.github.io/automated-news",
  descripcion: "Diario estático de noticias de tecnología.",
};

function edition(date: string, over: Record<string, unknown> = {}) {
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
  assert.ok(rssFeed.items[0]?.title?.includes("2026-09-18"));
  assert.ok((rssFeed.items[0]?.contentSnippet || rssFeed.items[0]?.content || "").includes("Titular"));
});

test("el Atom declara author a nivel de feed (RFC 4287)", () => {
  const atom = buildAtom({ site, editions: [edition("2026-09-18")] });
  assert.match(atom, /<author><name>La Terminal<\/name><\/author>/);
  // A nivel de feed basta para todas las entradas; repetirlo por entrada sobra.
  assert.equal(atom.match(/<author>/g)?.length, 1);
});

test("rfc822 cae a un fallback determinista, nunca al reloj del build", () => {
  const fallback = "2026-09-18T12:00:00Z";
  const rota = rfc822("no-es-una-fecha", fallback);
  assert.equal(rota, rfc822(undefined, fallback));
  assert.equal(rota, "Fri, 18 Sep 2026 12:00:00 GMT");
});

test("rfc822 no convierte null en 1970 y usa el fallback", () => {
  assert.equal(rfc822(null, "2026-09-18T12:00:00Z"), "Fri, 18 Sep 2026 12:00:00 GMT");
});

test("rfc822 lanza si ni la fecha ni el fallback parsean", () => {
  assert.throws(() => rfc822("no-es-una-fecha", "tambien-malo"), /fecha no válida/);
});

test("el pubDate del RSS no cambia entre builds si falta generated_at", () => {
  const sinGeneratedAt = [edition("2026-09-18", { generated_at: undefined })];
  const primera = buildRss({ site, editions: sinGeneratedAt });
  const segunda = buildRss({ site, editions: sinGeneratedAt });
  assert.match(primera, /<pubDate>Fri, 18 Sep 2026 12:00:00 GMT<\/pubDate>/);
  assert.equal(primera, segunda);
});

test("sitemap y robots apuntan a la URL de GitHub Pages", () => {
  const editions = [edition("2026-09-18")];
  const xml = buildSitemap(site.url, staticPagePaths(editions));
  assert.match(xml, /<urlset /);
  assert.match(xml, /<loc>https:\/\/idiagovaleta.github.io\/automated-news\/<\/loc>/);
  assert.match(xml, /\/2026\/09\/18\//);
  assert.match(xml, /\/semana\//);
  assert.match(xml, /\/archivo\/buscar\//);
  const robots = buildRobots(`${site.url}/sitemap.xml`);
  assert.match(robots, /Sitemap: https:\/\/idiagovaleta.github.io\/automated-news\/sitemap.xml/);
});

test("temaLabel traduce todos los temas del esquema y deja pasar uno desconocido", () => {
  const esperado: Record<string, string> = {
    programacion: "Programación",
    ia: "IA",
    web: "Web",
    datos: "Datos",
    arquitectura: "Arquitectura",
    diseno: "Diseño",
    carrera: "Carrera",
  };
  for (const [id, label] of Object.entries(esperado)) {
    assert.equal(temaLabel(id), label);
  }
  // El filtro no debe romper el build si el esquema cambia antes que la web.
  assert.equal(temaLabel("otro"), "otro");
});

test("lecturasPagePath sigue el patrón de rutas de la sección", () => {
  assert.equal(lecturasPagePath("2026-10-24"), "/lecturas/2026/10/24/");
});

test("el sitemap incluye la sección Lecturas y solo los días con lecturas", () => {
  const conLecturas = edition("2026-09-18", {
    lecturas: [
      {
        title: "Rust desde cero",
        url: "https://example.com/rust",
        source: "Medium: Programming",
        summary: "Primera frase.",
        tema: "programacion",
      },
    ],
  });
  const paths = staticPagePaths([conLecturas, edition("2026-09-17")]);
  assert.ok(paths.includes("/lecturas/"));
  assert.ok(paths.includes("/lecturas/2026/09/18/"));
  // Una edición sin lecturas no genera página: el filtro de la sección es la lista.
  assert.ok(!paths.includes("/lecturas/2026/09/17/"));
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
  assert.ok(String(week.tops[0].item.title).includes("2026-09-18"));
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

test("searchDocs no confunde code con Codex y prioriza el titular reciente", () => {
  const editions = [
    {
      date: "2026-09-18",
      path: "/2026/09/18/",
      items: [
        {
          title: "Claude Code estrena Projects",
          summary: "Novedad reciente.",
          source: "The Verge",
          category: "herramientas",
        },
      ],
    },
    {
      date: "2026-08-30",
      path: "/2026/08/30/",
      items: [
        {
          title: "Codex y Hermes instalan código",
          summary: "Otra pieza sobre asistentes de código.",
          source: "Ars Technica",
          category: "herramientas",
        },
      ],
    },
  ];
  const index = buildSearchIndex(editions);
  const hits = searchDocs(index, "Claude Code");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].date, "2026-09-18");
});

test("el índice de búsqueda incluye las lecturas con la ruta de su sección", () => {
  const lecturas = [
    {
      title: "Rust sin miedo",
      url: "https://example.com/rust",
      source: "Medium: Programming",
      summary: "Aprender Rust con calma.",
      tema: "programacion",
    },
  ];
  const index = buildSearchIndex([edition("2026-09-18", { lecturas })]);
  const lectura = index.find((d) => d.title === "Rust sin miedo");
  assert.ok(lectura, "la lectura no está en el índice");
  // Misma forma que una noticia, pero enlaza a la sección donde se lee.
  assert.deepEqual(lectura, {
    title: "Rust sin miedo",
    summary: "Aprender Rust con calma.",
    source: "Medium: Programming",
    category: "programacion",
    date: "2026-09-18",
    path: "/lecturas/2026/09/18/",
  });
});

test("Atom: <updated> de feed y entradas es ISO 8601 aunque falte o se corrompa generated_at", () => {
  const editions = [{ date: "2026-09-18", generated_at: "no-es-fecha", path: "/2026/09/18/", items: [] }];
  const xml = buildAtom({ site, editions });
  const fechas = [...xml.matchAll(/<updated>([^<]+)<\/updated>/g)].map((m) => m[1]);
  assert.deepEqual(fechas, ["2026-09-18T12:00:00.000Z", "2026-09-18T12:00:00.000Z"]);
});
