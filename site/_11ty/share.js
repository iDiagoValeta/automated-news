/** Web intents para publicar a mano el texto social ya generado. */

const X_INTENT = "https://x.com/intent/post";
const LINKEDIN_FEED = "https://www.linkedin.com/feed/";

/** True si hay texto publicable (best effort: vacío o no string no rompe). */
export function hasShareText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Compositor de X. `x.com/intent/post` es el alias actual; el histórico
 * `twitter.com/intent/tweet` sigue redirigiendo al mismo flujo. El post
 * ensamblado ya incluye la URL, así que no se pasa `url` aparte (X la
 * contaría otra vez).
 */
export function intentX(text) {
  if (!hasShareText(text)) return "";
  return `${X_INTENT}?text=${encodeURIComponent(text)}`;
}

/**
 * Compositor de LinkedIn. El endpoint documentado (`sharing/share-offsite`)
 * solo acepta una URL y no rellena el cuerpo. El feed con `shareActive` y
 * `text` abre el borrador con el post generado; no está documentado y puede
 * dejar de precargar. El botón de copiar es el fallback.
 */
export function intentLinkedIn(text) {
  if (!hasShareText(text)) return "";
  return `${LINKEDIN_FEED}?shareActive=true&text=${encodeURIComponent(text)}`;
}

/**
 * Modelo para la plantilla: un bloque por red, o null si falta el texto.
 * Así un social a medias no pinta botones rotos.
 */
export function shareModel(social) {
  const src = social && typeof social === "object" ? social : {};
  const x = hasShareText(src.x) ? src.x : "";
  const linkedin = hasShareText(src.linkedin) ? src.linkedin : "";
  return {
    x: x ? { text: x, href: intentX(x) } : null,
    linkedin: linkedin ? { text: linkedin, href: intentLinkedIn(linkedin) } : null,
  };
}
