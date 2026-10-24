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

/**
 * Fecha de una nota a partir del front matter crudo. YAML convierte una fecha
 * imposible en un Date ya normalizado (2026-02-30 -> 2026-03-02), así que el
 * único sitio donde sigue estando el día escrito es el texto del fichero.
 * Acepta el valor con o sin comillas.
 */
export function fechaFrontMatter(texto, fichero = "la nota") {
  const bloque = String(texto || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const linea = bloque && bloque[1].match(/^date:[ \t]*(.*)$/m);
  if (!linea) {
    throw new Error(`${fichero}: falta "date" o no es YYYY-MM-DD`);
  }
  // Entre comillas manda lo de dentro; sin comillas, un « #» abre comentario YAML.
  const crudo = linea[1].trim();
  const citado = crudo.match(/^(["'])(.*)\1(?:\s+#.*)?$/);
  return fechaNota(citado ? citado[2] : crudo.replace(/\s+#.*$/, ""), fichero);
}

/**
 * Texto obligatorio de una nota (title, resumen). Falla nombrando fichero y
 * campo: sin esto, la nota se publica vacía y el error aparece más tarde en
 * una plantilla o en el test.
 */
export function textoObligatorio(valor, campo, fichero = "la nota") {
  if (typeof valor !== "string" || !valor.trim()) {
    throw new Error(`${fichero}: falta "${campo}" o está vacío`);
  }
  return valor;
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
