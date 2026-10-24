import { fechaNota } from "../_11ty/editorial.js";

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
    fechaISO: (data) => fechaNota(data.date, data.page.inputPath),
  },
};
