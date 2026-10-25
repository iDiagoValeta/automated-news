// Paleta de búsqueda (⌘K / Ctrl+K / "/"): busca en todo el archivo desde
// cualquier página, con navegación por teclado. Inspirada en CommandBar y Seek de Bencho.
import { searchDocs } from "./search.js";

const base = new URL(import.meta.url).pathname.replace(/\/js\/paleta\.js.*$/, "");
let index = null;
let enCurso = null; // carga en vuelo, compartida entre llamadas concurrentes
let dlg, input, lista, activo = 0, items = [];
const reducido = matchMedia("(prefers-reduced-motion: reduce)");

function fecha(ymd) {
  const m = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [y, mm, d] = String(ymd).split("-").map(Number);
  return `${d} ${m[mm - 1]} ${y}`;
}

/**
 * Carga el índice una sola vez. Las llamadas concurrentes comparten una única
 * promesa: así una no puede fallar después de que otra haya cacheado el índice
 * y pintar un error que ya no corresponde.
 * Si falla devuelve `error: true` y NO cachea el fallo: el siguiente uso
 * reintenta. Solo se cachea un array; cualquier otra cosa es error de carga.
 */
async function cargar() {
  if (index) return { docs: index, error: false };
  if (!enCurso) {
    enCurso = (async () => {
      try {
        const r = await fetch(`${base}/search-index.json`);
        if (!r.ok) throw new Error(String(r.status));
        const docs = await r.json();
        if (!Array.isArray(docs)) throw new Error("el índice no es un array");
        index = docs;
        return { docs, error: false };
      } catch {
        return { docs: null, error: true };
      } finally {
        enCurso = null;
      }
    })();
  }
  return enCurso;
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
  // Esqueleto con brillo mientras llega el índice (solo la primera vez).
  if (!index && q.trim()) {
    lista.innerHTML = '<li class="paleta__esqueleto"></li>'.repeat(3);
  }
  const { docs, error } = await cargar();
  // La búsqueda más reciente manda: si el usuario escribió mientras llegaba el
  // índice, esta respuesta ya no describe el contenido del input.
  if (q !== input.value) return;
  lista.innerHTML = "";
  items = [];
  input.removeAttribute("aria-activedescendant");
  if (error) {
    lista.innerHTML = '<li class="paleta__vacio">No se pudo cargar el índice de búsqueda.</li>';
    return;
  }
  if (!q.trim()) {
    lista.innerHTML = '<li class="paleta__vacio">Escribe para buscar en el archivo.</li>';
    return;
  }
  const res = searchDocs(docs, q).slice(0, 8);
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

// El botón de buscar visible que hace de origen cuando se abre con teclado.
function origenVisible() {
  return [...document.querySelectorAll("[data-paleta]")].find((el) => el.getClientRects().length);
}

// La caja nace donde está el botón y se despliega desde él, como un único
// objeto (Seek de Bencho): primero el campo, hacia el lado con sitio, y luego
// los resultados hacia abajo.
function colocar(origen) {
  const margen = 12;
  const ancho = Math.min(560, innerWidth - margen * 2);
  const r = origen?.getBoundingClientRect();
  if (!r || !r.width) {
    dlg.style.left = `${(innerWidth - ancho) / 2}px`;
    dlg.style.top = "12vh";
    dlg.style.width = `${ancho}px`;
    return null;
  }
  const izquierda = r.left + r.width / 2 > innerWidth / 2
    ? Math.max(margen, r.right - ancho)
    : Math.min(innerWidth - margen - ancho, Math.max(margen, r.left));
  dlg.style.left = `${izquierda}px`;
  dlg.style.top = `${Math.max(margen, r.top - 6)}px`;
  dlg.style.width = `${ancho}px`;
  return r;
}

function desplegar(r) {
  if (!r || reducido.matches || !dlg.animate) return;
  const d = dlg.getBoundingClientRect();
  const recorte = (v) => `${Math.max(0, v)}px`;
  const desde = `inset(${recorte(r.top - d.top)} ${recorte(d.right - r.right)} ${recorte(d.bottom - r.bottom)} ${recorte(r.left - d.left)})`;
  dlg.animate(
    [{ clipPath: desde, opacity: 0.4 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }],
    { duration: 380, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" },
  );
}

function abrir(origen = origenVisible()) {
  if (!dlg) crear();
  if (dlg.open) return;
  const r = colocar(origen);
  dlg.showModal();
  desplegar(r);
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
  const origen = e.target.closest("[data-paleta]");
  if (origen) { e.preventDefault(); abrir(origen); }
});
