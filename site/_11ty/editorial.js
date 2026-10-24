/** Notas editoriales: rutas, colección publicada e integración con búsqueda y sitemap. */

/**
 * Fecha ISO (YYYY-MM-DD) de una nota. El front matter `date` llega como Date
 * porque YAML interpreta las fechas; las pruebas y los datos externos pueden
 * traer una cadena. Se normaliza en UTC para que el día no cambie con la zona
 * horaria de quien construye el sitio.
 */
export function fechaISO(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? "" : valor.toISOString().slice(0, 10);
  }
  return String(valor || "").slice(0, 10);
}

/**
 * Fecha obligatoria de una nota. Falla nombrando el fichero: sin esto, un
 * `date` ausente revienta más tarde en el filtro de fechas y el error señala
 * a la plantilla, no a la nota que hay que corregir.
 */
export function fechaNota(valor, fichero = "la nota") {
  const fecha = fechaISO(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error(`${fichero}: falta "date" o no es YYYY-MM-DD`);
  }
  const [y, m, d] = fecha.split("-").map(Number);
  const comprobacion = new Date(Date.UTC(y, m - 1, d));
  if (
    comprobacion.getUTCFullYear() !== y
    || comprobacion.getUTCMonth() !== m - 1
    || comprobacion.getUTCDate() !== d
  ) {
    throw new Error(`${fichero}: la fecha "${fecha}" no existe`);
  }
  return fecha;
}

/** Ruta pública de una nota. */
export function notaPath(slug) {
  return `/editorial/${slug}/`;
}

/**
 * Notas publicadas, de la más nueva a la más antigua. Un borrador
 * (`draft: true`) no se lista aunque Eleventy lo haya cargado.
 */
export function notasPublicadas(items) {
  return (items || [])
    .filter((item) => item && item.data && item.data.draft !== true)
    .slice()
    .sort((a, b) =>
      fechaISO(b.data.fechaISO || b.date).localeCompare(fechaISO(a.data.fechaISO || a.date)),
    );
}

/** Entrada del índice de búsqueda con la misma forma que noticias y lecturas. */
export function notaSearchEntry(item) {
  return {
    title: item.data.title || "",
    summary: item.data.resumen || "",
    // "Editorial" es la etiqueta que buscar.js y la paleta ya pintan en la
    // columna de fuente; no hace falta cambiar el cliente.
    source: "Editorial",
    category: "editorial",
    date: fechaISO(item.data.fechaISO || item.date),
    path: item.url || notaPath(item.fileSlug),
  };
}

/** Une el índice de las ediciones con las notas publicadas. */
export function searchIndexConNotas(base, items) {
  return [...(Array.isArray(base) ? base : []), ...notasPublicadas(items).map(notaSearchEntry)];
}

/**
 * Une las rutas estáticas con la portada de Editorial y sus notas. La portada
 * solo entra cuando hay alguna nota: una sección vacía no se anuncia ni en la
 * navegación ni en el sitemap.
 */
export function sitemapPathsConNotas(paths, items) {
  const publicadas = notasPublicadas(items);
  if (!publicadas.length) return [...new Set(paths || [])];
  return [
    ...new Set([
      ...(paths || []),
      "/editorial/",
      ...publicadas.map((item) => item.url || notaPath(item.fileSlug)),
    ]),
  ];
}
