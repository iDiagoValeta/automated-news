// Paleta de búsqueda (⌘K / Ctrl+K / "/"): busca en todo el archivo desde
// cualquier página, con navegación por teclado. Inspirada en CommandBar de Bencho.
import { searchDocs } from "./search.js";

const base = new URL(import.meta.url).pathname.replace(/\/js\/paleta\.js.*$/, "");
let index = null;
let dlg, input, lista, activo = 0, items = [];

function fecha(ymd) {
  const m = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [y, mm, d] = String(ymd).split("-").map(Number);
  return `${d} ${m[mm - 1]} ${y}`;
}

async function cargar() {
  if (index) return index;
  try {
    const r = await fetch(`${base}/search-index.json`);
    index = r.ok ? await r.json() : [];
  } catch {
    index = [];
  }
  return index;
}

function marcar(i) {
  if (!items.length) return;
  activo = (i + items.length) % items.length;
  items.forEach((el, n) => el.setAttribute("aria-selected", String(n === activo)));
  items[activo].scrollIntoView({ block: "nearest" });
  input.setAttribute("aria-activedescendant", items[activo].id);
}

async function buscar() {
  const q = input.value;
  const res = searchDocs(await cargar(), q).slice(0, 8);
  lista.innerHTML = "";
  items = [];
  input.removeAttribute("aria-activedescendant");
  if (!q.trim()) {
    lista.innerHTML = '<li class="paleta__vacio">Escribe para buscar en el archivo.</li>';
    return;
  }
  if (!res.length) {
    lista.innerHTML = `<li class="paleta__vacio">Sin resultados.</li>`;
    return;
  }
  res.forEach((doc, n) => {
    const li = document.createElement("li");
    li.id = `paleta-op-${n}`;
    li.setAttribute("role", "option");
    const a = document.createElement("a");
    a.href = `${base}${doc.path.startsWith("/") ? "" : "/"}${doc.path}`;
    a.tabIndex = -1;
    const t = document.createElement("span");
    t.className = "paleta__titulo";
    t.textContent = doc.title;
    const m = document.createElement("span");
    m.className = "paleta__meta";
    m.textContent = `${fecha(doc.date)} · ${doc.source}`;
    a.append(t, m);
    li.append(a);
    li.addEventListener("mousemove", () => activo !== n && marcar(n));
    lista.append(li);
    items.push(li);
  });
  marcar(0);
}

function crear() {
  dlg = document.createElement("dialog");
  dlg.className = "paleta";
  dlg.setAttribute("aria-label", "Buscar en el archivo");
  dlg.innerHTML = `
    <div class="paleta__caja">
      <input class="paleta__input" type="search" placeholder="Buscar noticias…" autocomplete="off"
        role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list" />
      <kbd class="paleta__kbd">Esc</kbd>
    </div>
    <ul class="paleta__lista" id="paleta-lista" role="listbox"></ul>
    <p class="paleta__pie"><kbd>↑</kbd><kbd>↓</kbd> moverse <kbd>↵</kbd> abrir</p>`;
  document.body.append(dlg);
  input = dlg.querySelector("input");
  lista = dlg.querySelector("ul");
  input.addEventListener("input", buscar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); marcar(activo + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); marcar(activo - 1); }
    else if (e.key === "Enter" && items[activo]) {
      e.preventDefault();
      location.href = items[activo].querySelector("a").href;
    }
  });
  // Clic fuera de la caja (en el backdrop) cierra.
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

function abrir() {
  if (!dlg) crear();
  if (dlg.open) return;
  dlg.showModal();
  input.select();
  buscar();
}

document.addEventListener("keydown", (e) => {
  const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")
    || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); abrir(); }
  else if (e.key === "/" && !escribiendo) { e.preventDefault(); abrir(); }
});
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-paleta]")) { e.preventDefault(); abrir(); }
});
