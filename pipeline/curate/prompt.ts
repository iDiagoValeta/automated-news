// Utilidades compartidas por los prompts de curación. Viven en un módulo propio
// para que los casos de uso (lecturas, repos) no dependan de su orquestador
// (index.ts), que a su vez los importa: así no hay ciclo.

/** Quita las vallas de un bloque markdown (```json ... ```) antes de parsear. */
export function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

/** Delimita contenido de terceros para que el modelo lo trate como dato, no como instrucciones. */
export function untrustedBlock(body: string): string {
  return `===== INICIO CONTENIDO NO CONFIABLE =====\n${body}\n===== FIN CONTENIDO NO CONFIABLE =====`;
}

/**
 * Colapsa espacios y saltos de línea y recorta. Se aplica antes de recortar
 * porque un título con saltos podría cerrar el bloque delimitado y lo que
 * venga después se leería como instrucciones.
 */
export function collapseText(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
