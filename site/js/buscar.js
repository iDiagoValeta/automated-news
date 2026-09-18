import { searchDocs } from "./search.js";

function formatFecha(ymd) {
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [y, m, d] = String(ymd).split("-").map(Number);
  return `${d} ${meses[m - 1]} ${y}`;
}

function prefix() {
  const script = document.querySelector("script[src*='buscar.js']");
  if (!script) return "";
  try {
    return new URL(script.src).pathname.replace(/\/js\/buscar\.js.*$/, "");
  } catch {
    return "";
  }
}

function editionHref(path) {
  const base = prefix();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function render(results, query, estado, lista) {
  lista.innerHTML = "";
  if (!query.trim()) {
    estado.hidden = true;
    return;
  }
  estado.hidden = false;
  if (results.length === 0) {
    estado.textContent = `Ningún resultado para «${query}».`;
    return;
  }
  estado.textContent =
    results.length === 1 ? "1 resultado." : `${results.length} resultados.`;
  for (const doc of results.slice(0, 80)) {
    const li = document.createElement("li");
    li.className = "buscar-resultados__item";
    const a = document.createElement("a");
    a.href = editionHref(doc.path);
    const fecha = document.createElement("span");
    fecha.className = "archivo__fecha";
    fecha.textContent = formatFecha(doc.date);
    const lead = document.createElement("span");
    lead.className = "archivo__lead";
    lead.textContent = doc.title;
    const meta = document.createElement("span");
    meta.className = "archivo__count";
    meta.textContent = doc.source;
    a.append(fecha, lead, meta);
    li.appendChild(a);
    lista.appendChild(li);
  }
}

async function init() {
  const form = document.getElementById("buscar");
  if (!form) return;
  const input = form.querySelector("#q");
  const estado = document.getElementById("buscar-estado");
  const lista = document.getElementById("buscar-resultados");
  const indexUrl = form.getAttribute("data-index");
  if (!input || !estado || !lista || !indexUrl) return;

  let index = [];
  try {
    const res = await fetch(indexUrl);
    if (!res.ok) throw new Error(String(res.status));
    index = await res.json();
  } catch {
    estado.hidden = false;
    estado.textContent = "No se pudo cargar el índice de búsqueda.";
    return;
  }

  function run(q) {
    const query = q || "";
    const results = searchDocs(index, query);
    render(results, query, estado, lista);
  }

  const initial = new URLSearchParams(window.location.search).get("q") || "";
  if (initial) {
    input.value = initial;
    run(initial);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    const url = new URL(window.location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    run(q);
  });

  input.addEventListener("input", () => {
    run(input.value);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init();
    });
  } else {
    init();
  }
}
