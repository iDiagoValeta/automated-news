import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// data/ vive en la raíz del repo; este archivo está en site/_data/.
const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));

export default function editions() {
  let files;
  try {
    files = readdirSync(dataDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  } catch {
    return [];
  }

  const editions = files.map((f) => {
    let d;
    try {
      d = JSON.parse(readFileSync(dataDir + f, "utf8"));
    } catch (causa) {
      // El contenido lo escribe un LLM y se corrompe; sin el nombre del fichero
      // el build muere con un SyntaxError que no señala al culpable.
      throw new Error(`data/${f} no parsea: ${causa.message}`, { cause: causa });
    }
    if (!d || typeof d.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      throw new Error(`data/${f} no parsea: falta la fecha "date" o no es YYYY-MM-DD`);
    }
    const [y, m, day] = d.date.split("-");
    // Date.UTC normaliza fechas imposibles (2026-13-40 avanza de mes), así que
    // se comparan los componentes resultantes con los declarados.
    const fecha = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day)));
    if (
      fecha.getUTCFullYear() !== Number(y)
      || fecha.getUTCMonth() !== Number(m) - 1
      || fecha.getUTCDate() !== Number(day)
    ) {
      throw new Error(`data/${f} no parsea: la fecha "date" no existe`);
    }
    // Vacío publicaría una edición sin noticia destacada; un null tumbaría la
    // ordenación de abajo con un TypeError sin nombre de fichero.
    if (!Array.isArray(d.items) || d.items.length === 0 || !d.items.every((it) => it && typeof it === "object")) {
      throw new Error(`data/${f} no parsea: "items" debe ser un array no vacío de objetos`);
    }
    d.items = d.items.slice().sort((a, b) => a.rank - b.rank);
    d.year = y;
    d.month = m;
    d.day = day;
    d.path = `/${y}/${m}/${day}/`;
    return d;
  });

  // Más reciente primero.
  editions.sort((a, b) => b.date.localeCompare(a.date));

  editions.forEach((e, i) => {
    e.numero = editions.length - i; // la edición más antigua es la Nº 1
    e.newerPath = i > 0 ? editions[i - 1].path : null; // edición siguiente (más reciente)
    e.olderPath = i < editions.length - 1 ? editions[i + 1].path : null; // anterior
  });

  return editions;
}
