import editions from "./editions.js";

// Ediciones que tienen sección de repos, ya ordenadas de más reciente a más
// antigua. Añade la ruta bajo /repositorios/ y los vecinos (día anterior /
// siguiente) calculados solo entre las ediciones con repos.
export default function reposEditions() {
  const list = editions()
    .filter((e) => Array.isArray(e.repos) && e.repos.length > 0)
    .map((e) => ({ ...e, reposPath: `/repositorios/${e.year}/${e.month}/${e.day}/` }));

  list.forEach((e, i) => {
    e.reposNewerPath = i > 0 ? list[i - 1].reposPath : null;
    e.reposOlderPath = i < list.length - 1 ? list[i + 1].reposPath : null;
  });

  return list;
}
