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
    const d = JSON.parse(readFileSync(dataDir + f, "utf8"));
    d.items = (d.items || []).slice().sort((a, b) => a.rank - b.rank);
    const [y, m, day] = d.date.split("-");
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
