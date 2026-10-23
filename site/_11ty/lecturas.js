/** Etiquetas de tema de las lecturas y rutas de su sección. */

// El esquema guarda identificadores sin tilde; en pantalla se leen con su
// ortografía, igual que pasa con las categorías de noticias.
const TEMAS = {
  programacion: "Programación",
  ia: "IA",
  web: "Web",
  datos: "Datos",
  arquitectura: "Arquitectura",
  diseno: "Diseño",
  carrera: "Carrera",
};

// Un tema desconocido se muestra tal cual: el schema puede adelantarse a la web
// y una etiqueta rara no debe tumbar el build.
export function temaLabel(tema) {
  return TEMAS[tema] || tema;
}

/** "2026-10-24" -> "/lecturas/2026/10/24/" */
export function lecturasPagePath(date) {
  const [y, m, d] = String(date).split("-");
  return `/lecturas/${y}/${m}/${d}/`;
}
