import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Hash corto del contenido de cada asset, para cache-busting: el navegador
// vuelve a descargar el archivo solo cuando cambia (evita servir CSS/JS viejo
// de caché tras un despliegue).
function hash(relPath) {
  try {
    const p = fileURLToPath(new URL("../" + relPath, import.meta.url));
    return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 8);
  } catch {
    return "0";
  }
}

export default function assets() {
  return {
    css: hash("css/diario.css"),
    calendario: hash("js/calendario.js"),
    compartir: hash("js/compartir.js"),
  };
}
