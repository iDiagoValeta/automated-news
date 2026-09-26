// Configuración de Eleventy (v3, ESM). Genera el sitio desde site/ leyendo
// las ediciones de data/*.json vía site/_data/editions.js.

import { shareModel } from "./site/_11ty/share.js";

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

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "site/css": "css" });
  eleventyConfig.addPassthroughCopy({ "site/js": "js" });
  eleventyConfig.addPassthroughCopy({ "site/img": "img" });
  eleventyConfig.addPassthroughCopy({ "site/_11ty/search.js": "js/search.js" });

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

  // Recorta un texto para meta description / Open Graph.
  eleventyConfig.addFilter("metaDesc", (s, max = 200) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const sp = cut.lastIndexOf(" ");
    return `${(sp > 80 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  });

  // Convierte item.social en hrefs de web intent (vacío si falta el texto).
  eleventyConfig.addFilter("shareModel", shareModel);

  // El esquema guarda las categorías sin tilde (son identificadores); en
  // pantalla se muestran con su ortografía.
  const CATEGORIAS = { investigacion: "investigación" };
  eleventyConfig.addFilter("categoria", (c) => CATEGORIAS[c] || c);

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
