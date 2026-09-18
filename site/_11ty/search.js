/** Índice y búsqueda client-side sobre título, resumen y fuente. */

export function buildSearchIndex(editions) {
  const out = [];
  for (const e of editions || []) {
    for (const it of e.items || []) {
      out.push({
        title: it.title || "",
        summary: it.summary || "",
        source: it.source || "",
        category: it.category || "",
        date: e.date,
        path: e.path,
      });
    }
  }
  return out;
}

export function tokenize(query) {
  return String(query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function fieldTokens(text) {
  return new Set(tokenize(text));
}

/**
 * Puntuación simple: coincidencia de tokens en título (3), fuente (2) y
 * resumen (1). Sin dependencias: el índice cabe entero en el cliente.
 */
export function searchDocs(index, query) {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const scored = [];
  for (const doc of index) {
    const titleToks = fieldTokens(doc.title);
    const sourceToks = fieldTokens(doc.source);
    const summaryToks = fieldTokens(doc.summary);
    let score = 0;
    let hits = 0;
    for (const t of terms) {
      let hit = false;
      if (titleToks.has(t)) {
        score += 3;
        hit = true;
      }
      if (sourceToks.has(t)) {
        score += 2;
        hit = true;
      }
      if (summaryToks.has(t)) {
        score += 1;
        hit = true;
      }
      if (hit) hits += 1;
    }
    if (hits === 0) continue;
    if (hits === terms.length) score += 2;
    scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || b.doc.date.localeCompare(a.doc.date));
  return scored.map((x) => x.doc);
}
