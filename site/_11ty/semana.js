const LABELS = {
  lanzamientos: "Lanzamientos",
  investigacion: "Investigación",
  industria: "Industria",
  herramientas: "Herramientas",
};

function parseYmd(s) {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d };
}

/** Suma (o resta) días a una fecha YYYY-MM-DD en calendario gregoriano. */
export function addDays(ymd, delta) {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Resumen de la ventana de `days` días civiles que termina en la edición más
 * reciente: destacada de cada día (rank 1), temas por categoría y repos.
 */
export function buildWeek(editions, days = 7) {
  const list = editions || [];
  if (list.length === 0) {
    return { from: null, to: null, editions: [], tops: [], categories: [], repos: [] };
  }
  const to = list[0].date;
  const from = addDays(to, -(days - 1));
  const week = list.filter((e) => e.date >= from && e.date <= to);

  const tops = week
    .map((e) => ({
      date: e.date,
      path: e.path,
      item: (e.items || [])[0] || null,
    }))
    .filter((x) => x.item);

  const catCount = new Map();
  for (const e of week) {
    for (const it of e.items || []) {
      catCount.set(it.category, (catCount.get(it.category) || 0) + 1);
    }
  }
  const categories = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, label: LABELS[id] || id, count }));

  const repos = [];
  const seen = new Set();
  for (const e of week) {
    for (const r of e.repos || []) {
      if (!r?.name || seen.has(r.name)) continue;
      seen.add(r.name);
      repos.push({ ...r, date: e.date, path: e.path });
    }
  }

  return { from, to, editions: week, tops, categories, repos };
}
