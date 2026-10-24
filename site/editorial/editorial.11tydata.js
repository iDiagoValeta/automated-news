import { readFileSync } from "node:fs";

import { fechaFrontMatter, textoObligatorio } from "../_11ty/editorial.js";

// Datos comunes de las notas de site/editorial/: layout, colección y ruta.
// Los borradores siguen en el repo mientras se escriben, pero no generan
// página ni entran en colecciones, así que no aparecen en la web.
export default {
  layout: "nota.njk",
  tags: ["notas"],
  eleventyComputed: {
    permalink: (data) => (data.draft === true ? false : `/editorial/${data.page.fileSlug}/`),
    eleventyExcludeFromCollections: (data) => data.draft === true,
    // La meta description y el índice leen el resumen. No se duplica el campo.
    description: (data) => data.resumen || "",
    // El front matter crudo, no el Date de YAML: una fecha imposible se
    // normaliza antes de llegar aquí y se publicaría con otro día.
    fechaISO: (data) => fechaFrontMatter(
      readFileSync(data.page.inputPath, "utf8"),
      data.page.inputPath,
    ),
    // Los campos obligatorios se exigen en el build, no en la plantilla: así
    // falla nombrando el fichero y el campo en lugar de publicar una nota vacía.
    camposValidos: (data) => {
      if (data.draft !== true) {
        textoObligatorio(data.title, "title", data.page.inputPath);
        textoObligatorio(data.resumen, "resumen", data.page.inputPath);
      }
      return true;
    },
  },
};
