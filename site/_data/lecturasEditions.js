import editions from "./editions.js";
import { lecturasPagePath } from "../_11ty/lecturas.js";

// Ediciones que traen lecturas, de más reciente a más antigua. Añade la ruta
// bajo /lecturas/ y los vecinos (día anterior / siguiente) calculados solo
// entre las ediciones con lecturas, igual que en reposEditions.
export default function lecturasEditions() {
  const list = editions()
    .filter((e) => Array.isArray(e.lecturas) && e.lecturas.length > 0)
    .map((e) => ({ ...e, lecturasPath: lecturasPagePath(e.date) }));

  list.forEach((e, i) => {
    e.lecturasNewerPath = i > 0 ? list[i - 1].lecturasPath : null;
    e.lecturasOlderPath = i < list.length - 1 ? list[i + 1].lecturasPath : null;
  });

  return list;
}
