import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fechaISO,
  fechaNota,
  notaPath,
  notaSearchEntry,
  notasPublicadas,
  searchIndexConNotas,
  sitemapPathsConNotas,
} from "../../site/_11ty/editorial.js";
import { buildSitemap } from "../../site/_11ty/feeds.js";
import { searchDocs } from "../../site/_11ty/search.js";

function nota(slug: string, fecha: string, data: Record<string, unknown> = {}) {
  return {
    fileSlug: slug,
    url: `/editorial/${slug}/`,
    date: new Date(`${fecha}T00:00:00.000Z`),
    data: {
      title: `Nota ${slug}`,
      resumen: `Resumen de ${slug}.`,
      fechaISO: fecha,
      ...data,
    },
  };
}

test("fechaISO normaliza la fecha de YAML y la de una cadena", () => {
  assert.equal(fechaISO(new Date("2026-10-24T00:00:00.000Z")), "2026-10-24");
  assert.equal(fechaISO("2026-10-24"), "2026-10-24");
  assert.equal(fechaISO(undefined), "");
  assert.equal(fechaISO(new Date("no-es-fecha")), "");
});

test("notaPath construye la ruta de la sección", () => {
  assert.equal(notaPath("mi-nota"), "/editorial/mi-nota/");
});

test("fechaNota exige una fecha real y nombra el fichero culpable", () => {
  assert.equal(fechaNota("2026-10-24", "site/editorial/mi-nota.md"), "2026-10-24");
  assert.throws(
    () => fechaNota(undefined, "site/editorial/mi-nota.md"),
    /site\/editorial\/mi-nota\.md.*date/,
  );
  assert.throws(
    () => fechaNota("2026-13-40", "site/editorial/mi-nota.md"),
    /site\/editorial\/mi-nota\.md.*2026-13-40/,
  );
});

test("notasPublicadas descarta borradores y ordena de nueva a antigua", () => {
  const items = [
    nota("antigua", "2026-10-01"),
    nota("borrador", "2026-10-20", { draft: true }),
    nota("nueva", "2026-10-24"),
  ];
  assert.deepEqual(
    notasPublicadas(items).map((n) => n.fileSlug),
    ["nueva", "antigua"],
  );
});

test("notaSearchEntry usa la forma común del índice y la etiqueta Editorial", () => {
  assert.deepEqual(notaSearchEntry(nota("mi-nota", "2026-10-24")), {
    title: "Nota mi-nota",
    summary: "Resumen de mi-nota.",
    source: "Editorial",
    category: "editorial",
    date: "2026-10-24",
    path: "/editorial/mi-nota/",
  });
});

test("searchIndexConNotas conserva el índice base y añade solo las notas publicadas", () => {
  const base = [
    {
      title: "Titular de portada",
      summary: "Resumen.",
      source: "The Verge",
      category: "lanzamientos",
      date: "2026-10-23",
      path: "/2026/10/23/",
    },
  ];
  const index = searchIndexConNotas(base, [
    nota("publicada", "2026-10-24"),
    nota("borrador", "2026-10-22", { draft: true }),
  ]);
  assert.equal(index.length, 2);
  assert.equal(index[0].title, "Titular de portada");
  assert.equal(index[1].path, "/editorial/publicada/");
  // La etiqueta visible en la paleta no depende de tocar el cliente.
  assert.equal(index[1].source, "Editorial");
  assert.equal(searchDocs(index, "Nota publicada")[0].path, "/editorial/publicada/");
});

test("sitemapPathsConNotas publica la sección y sus notas solo si hay alguna", () => {
  const base = ["/", "/semana/"];
  assert.deepEqual(sitemapPathsConNotas(base, []), ["/", "/semana/"]);
  assert.deepEqual(
    sitemapPathsConNotas(base, [
      nota("publicada", "2026-10-24"),
      nota("borrador", "2026-10-22", { draft: true }),
    ]),
    ["/", "/semana/", "/editorial/", "/editorial/publicada/"],
  );
  // Una nota repetida no duplica la URL del sitemap.
  assert.deepEqual(
    sitemapPathsConNotas(["/editorial/publicada/"], [nota("publicada", "2026-10-24")]),
    ["/editorial/publicada/", "/editorial/"],
  );
});

test("buildSitemap produce la URL absoluta de una nota editorial", () => {
  const paths = sitemapPathsConNotas([], [nota("mi-nota", "2026-10-24")]);
  const xml = buildSitemap("https://idiagovaleta.github.io/automated-news", paths);
  assert.match(xml, /<loc>https:\/\/idiagovaleta.github.io\/automated-news\/editorial\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/idiagovaleta.github.io\/automated-news\/editorial\/mi-nota\/<\/loc>/);
});
