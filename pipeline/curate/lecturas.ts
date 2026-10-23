import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { log, warn } from "../log.ts";
import type { Digest, Lectura, LecturaTema, NewsItem } from "../types.ts";
import type { Provider } from "../ports.ts";
import { previousEditionDates } from "./repos.ts";
import { collapseText, untrustedBlock } from "./index.ts";

const LECTURAS_PROMPT_PATH = fileURLToPath(new URL("../../prompts/lecturas.md", import.meta.url));

/** Temas que admite el schema y el prompt. */
const TEMAS: LecturaTema[] = [
  "programacion",
  "ia",
  "web",
  "datos",
  "arquitectura",
  "diseno",
  "carrera",
];

interface PickedLectura {
  url?: unknown;
  title?: unknown;
  summary?: unknown;
  tema?: unknown;
}

function stripFences(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

/**
 * URLs ya publicadas en la sección Lecturas de las ediciones de los `days`
 * días previos a `beforeDate`. Ignora ficheros ausentes o JSON inválidos: la
 * exclusión es best effort y no puede tumbar la edición.
 */
export function loadRecentLecturaUrls(dataDir: string, beforeDate: string, days: number): Set<string> {
  const urls = new Set<string>();
  for (const day of previousEditionDates(beforeDate, days)) {
    const path = join(dataDir, `${day}.json`);
    if (!existsSync(path)) continue;
    try {
      const digest = JSON.parse(readFileSync(path, "utf8")) as Digest;
      for (const lectura of digest.lecturas ?? []) {
        if (typeof lectura.url === "string" && lectura.url) urls.add(lectura.url);
      }
    } catch {
      // best effort: un JSON corrupto no tumba la edición
    }
  }
  return urls;
}

/** Quita de los candidatos las lecturas ya publicadas en la ventana reciente. */
export function excludeRecentLecturas(candidates: NewsItem[], recent: Set<string>): NewsItem[] {
  if (recent.size === 0) return candidates;
  return candidates.filter((c) => !recent.has(c.url));
}

function buildLecturasPrompt(candidates: NewsItem[], pick: number): string {
  const header =
    `Elige las ${pick} lecturas más útiles y atemporales y resúmelas en castellano.\n\n` +
    `Candidatas (${candidates.length}). Copia las URL LITERALMENTE:\n\n`;
  const body = candidates
    .map((c, i) => {
      const text = collapseText(c.snippet, 500);
      const snip = text ? `\n   ${text}` : "";
      return `${i + 1}. [${c.source}] ${collapseText(c.title, 200)}${snip}\n   URL: ${c.url}`;
    })
    .join("\n\n");
  return `${header}${untrustedBlock(body)}`;
}

/**
 * Curación de la sección Lecturas (best effort, una llamada al modelo): de las
 * candidatas recogidas elige las más útiles, las titula y resume en español y
 * les asigna un tema. La URL y la fuente salen SIEMPRE del candidato, nunca de
 * la respuesta, y todo lo inválido se descarta con un aviso. Si falla, la
 * edición se publica sin la sección.
 */
export async function attachLecturas(
  provider: Provider,
  digest: Digest,
  candidates: NewsItem[],
  pick: number,
): Promise<void> {
  if (candidates.length === 0) return;
  try {
    const system = readFileSync(LECTURAS_PROMPT_PATH, "utf8");
    const raw = await provider.generate(system, buildLecturasPrompt(candidates, pick));
    const parsed = JSON.parse(stripFences(raw)) as { lecturas?: PickedLectura[] };
    const picked = Array.isArray(parsed.lecturas) ? parsed.lecturas : [];
    const byUrl = new Map(candidates.map((c) => [c.url, c]));
    const seen = new Set<string>();

    const lecturas: Lectura[] = [];
    for (const raw of picked) {
      if (!raw || typeof raw !== "object") {
        warn("Lecturas: descartada una entrada que no es un objeto.");
        continue;
      }
      const p = raw as PickedLectura;
      if (typeof p.url !== "string") {
        warn("Lecturas: descartada una entrada sin URL.");
        continue;
      }
      const src = byUrl.get(p.url);
      if (!src) {
        // El modelo no puede introducir lecturas ausentes de la entrada.
        warn("Lecturas: descartada una URL fuera de la entrada.", p.url);
        continue;
      }
      if (seen.has(src.url)) continue;
      const title = collapseText(typeof p.title === "string" ? p.title : "", 200);
      if (!title) {
        warn("Lecturas: descartada una entrada sin título.", src.url);
        continue;
      }
      const summary = collapseText(typeof p.summary === "string" ? p.summary : "", 600);
      if (!summary) {
        warn("Lecturas: descartada una entrada sin resumen.", src.url);
        continue;
      }
      if (typeof p.tema !== "string" || !TEMAS.includes(p.tema as LecturaTema)) {
        warn("Lecturas: descartada una entrada con tema inválido.", String(p.tema));
        continue;
      }
      lecturas.push({
        title,
        url: src.url,
        source: src.source,
        summary,
        tema: p.tema as LecturaTema,
      });
      seen.add(src.url);
      if (lecturas.length >= pick) break;
    }

    if (lecturas.length > 0) {
      digest.lecturas = lecturas;
      log(`Lecturas: ${lecturas.length} seleccionadas de ${candidates.length} candidatas.`);
    }
  } catch (e) {
    warn("No se pudo generar la sección de lecturas; la edición se publica sin ella.", String(e));
  }
}
