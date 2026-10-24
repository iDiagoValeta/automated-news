// Configuración de Eleventy (v3, ESM). Genera el sitio desde site/ leyendo
// las ediciones de data/*.json vía site/_data/editions.js.

import { shareModel } from "./site/_11ty/share.js";
import { temaLabel } from "./site/_11ty/lecturas.js";
import { searchIndexConNotas, sitemapPathsConNotas } from "./site/_11ty/editorial.js";
import { buildSitemap } from "./site/_11ty/feeds.js";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function parseYMD(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d };
}

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Recorta un texto para meta description / Open Graph. Exportada para que el
// test e2e compare contra el mismo recorte que aplica base.njk.
export function metaDesc(s, max = 200) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 80 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "site/css": "css" });
  eleventyConfig.addPassthroughCopy({ "site/js": "js" });
  eleventyConfig.addPassthroughCopy({ "site/img": "img" });
  eleventyConfig.addPassthroughCopy({ "site/_11ty/search.js": "js/search.js" });
  // search.js corre en el navegador y ahora importa este helper: sin copiarlo,
  // el índice de búsqueda pide un módulo que no existe.
  eleventyConfig.addPassthroughCopy({ "site/_11ty/lecturas.js": "js/lecturas.js" });

  // Minificación ligera del HTML: la indentación de las plantillas entre
  // etiquetas pesa sin aportar nada. Se deja un espacio (no nada) para no
  // juntar elementos en línea, y se respetan los bloques donde el espacio
  // importa o es contenido (pre, textarea, script, style).
  eleventyConfig.addTransform("minificaHtml", function (contenido) {
    // Un permalink: false (borrador) deja outputPath en false, no en cadena.
    const salida = this.page.outputPath;
    if (typeof salida !== "string" || !salida.endsWith(".html")) return contenido;
    return contenido
      .split(/(<(?:pre|textarea|script|style)\b[\s\S]*?<\/(?:pre|textarea|script|style)>)/i)
      .map((trozo, i) => (i % 2 ? trozo : trozo.replace(/>\s+</g, "> <")))
      .join("");
  });

  // "2026-07-18" -> "sábado, 18 de julio de 2026"
  eleventyConfig.addFilter("fechaLarga", (s) => {
    const d = new Date(`${s}T12:00:00Z`);
    const dia = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: "UTC" }).format(d);
    const { d: day, m, y } = parseYMD(s);
    return `${capitalizar(dia)}, ${day} de ${MESES[m - 1]} de ${y}`;
  });

  // "2026-07-18" -> "18 jul"
  eleventyConfig.addFilter("fechaCorta", (s) => {
    const { d, m } = parseYMD(s);
    return `${d} ${MESES[m - 1].slice(0, 3)}`;
  });

  // "2026-07" -> "julio de 2026"
  eleventyConfig.addFilter("nombreMes", (key) => {
    const [y, m] = key.split("-").map(Number);
    return `${capitalizar(MESES[m - 1])} de ${y}`;
  });

  // 19993 -> "19.993", 9312 -> "9.312" (separador de miles, agrupando siempre).
  eleventyConfig.addFilter("miles", (n) =>
    new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Number(n)),
  );

  eleventyConfig.addFilter("metaDesc", metaDesc);

  // Convierte item.social en hrefs de web intent (vacío si falta el texto).
  eleventyConfig.addFilter("shareModel", shareModel);

  // El esquema guarda las categorías sin tilde (son identificadores); en
  // pantalla se muestran con su ortografía.
  const CATEGORIAS = { investigacion: "investigación" };
  eleventyConfig.addFilter("categoria", (c) => CATEGORIAS[c] || c);

  // Temas de las lecturas: mismos identificadores sin tilde, misma traducción.
  eleventyConfig.addFilter("tema", temaLabel);

  // Las notas son una colección, y las colecciones no existen cuando se
  // calculan los datos globales. Por eso el sitemap y el índice se completan
  // al renderizar sus plantillas, no en site/_data/derived.js.
  eleventyConfig.addFilter("sitemapConNotas", (paths, notas, siteUrl) =>
    buildSitemap(siteUrl, sitemapPathsConNotas(paths, notas)),
  );
  eleventyConfig.addFilter("indiceConNotas", (baseJson, notas) =>
    JSON.stringify(searchIndexConNotas(JSON.parse(baseJson), notas)),
  );

  // Agrupa ediciones (ya ordenadas desc) por año-mes para el archivo.
  eleventyConfig.addFilter("agrupaPorMes", (editions) => {
    const groups = new Map();
    for (const e of editions) {
      const key = `${e.year}-${e.month}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    return [...groups.entries()].map(([key, items]) => ({ key, items }));
  });

  return {
    dir: { input: "site", output: "_site", includes: "_includes", data: "_data" },
    pathPrefix: "/automated-news/",
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    templateFormats: ["njk", "md"],
  };
}
