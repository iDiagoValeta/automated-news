// La descripción de la edición se construye aquí, en JS, y no como cadena de
// plantilla en eleventyComputed: esa cadena se renderiza con autoescape y luego
// base.njk vuelve a escapar, así que un "&" acababa en "&amp;amp;" en la meta
// description y en las etiquetas og:/twitter:.
export default {
  eleventyComputed: {
    description: (data) => data.edition?.items?.[0]?.summary || "",
  },
};
