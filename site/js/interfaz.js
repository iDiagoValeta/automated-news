// Interacciones de la interfaz, inspiradas en bloques de Bencho (bencho.dev):
// interruptor de tema (LiquidToggle), indicador deslizante del menú (GooTabs),
// progreso de lectura por marcas (ProgressTicks), selector de tipografía y
// cursor retro pixelado.
// Todo es mejora progresiva: sin JS la página funciona igual.

const reducirMovimiento = matchMedia("(prefers-reduced-motion: reduce)");
const oscuroSistema = matchMedia("(prefers-color-scheme: dark)");

/* ---------- Tema claro / oscuro ---------- */

function temaActual() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return oscuroSistema.matches ? "dark" : "light";
}

function initTema() {
  const btn = document.querySelector(".tema");
  if (!btn) return;
  const pintar = () => btn.setAttribute("aria-checked", String(temaActual() === "dark"));
  pintar();
  btn.hidden = false;
  btn.addEventListener("click", () => {
    const nuevo = temaActual() === "dark" ? "light" : "dark";
    const html = document.documentElement;
    if (!reducirMovimiento.matches) {
      html.classList.add("is-cambiando-tema");
      setTimeout(() => html.classList.remove("is-cambiando-tema"), 400);
    }
    html.dataset.theme = nuevo;
    try {
      localStorage.setItem("tema", nuevo);
    } catch {
      /* sin almacenamiento: el cambio dura hasta recargar */
    }
    pintar();
  });
  oscuroSistema.addEventListener("change", pintar);
}

/* ---------- Indicador deslizante del menú ---------- */

function initIndicador() {
  const nav = document.querySelector(".masthead__nav");
  if (!nav) return;
  const enlaces = [...nav.querySelectorAll("a")];
  const ind = document.createElement("span");
  ind.className = "masthead__indicador";
  ind.setAttribute("aria-hidden", "true");
  nav.append(ind);
  nav.classList.add("has-indicador");

  const activo = () => nav.querySelector("a.is-active");
  function mover(a) {
    if (!a) {
      ind.style.opacity = "0";
      return;
    }
    ind.style.opacity = "1";
    ind.style.width = `${a.offsetWidth}px`;
    ind.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop + a.offsetHeight + 4}px)`;
  }

  mover(activo());
  // Primera colocación sin animar; a partir de aquí, se desliza.
  requestAnimationFrame(() => requestAnimationFrame(() => ind.classList.add("is-listo")));

  for (const a of enlaces) {
    a.addEventListener("pointerenter", () => mover(a));
    a.addEventListener("focus", () => mover(a));
  }
  nav.addEventListener("pointerleave", () => mover(activo()));
  nav.addEventListener("focusout", (e) => {
    if (!nav.contains(e.relatedTarget)) mover(activo());
  });
  addEventListener("resize", () => mover(activo()));
  // Las fuentes pueden cambiar el ancho de los enlaces tras cargar.
  document.fonts?.ready.then(() => mover(activo()));
}

/* ---------- Progreso de lectura por marcas ---------- */

function initProgreso() {
  const lista = () => [...document.querySelectorAll(".lead, .story, .repo")];
  if (lista().length < 3) return;

  const barra = document.createElement("div");
  barra.className = "progreso";
  barra.setAttribute("aria-hidden", "true");
  document.body.prepend(barra);

  let arts = [];
  let marcas = [];
  function construir() {
    arts = lista();
    barra.replaceChildren();
    marcas = arts.map(() => {
      const m = document.createElement("span");
      m.className = "progreso__marca";
      barra.append(m);
      return m;
    });
    actualizar();
  }

  let pendiente = false;
  function actualizar() {
    pendiente = false;
    const umbral = innerHeight * 0.55;
    const alFinal = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    // Leída: su final ya pasó la mitad de la pantalla. Actual: la primera sin leer
    // que ya ha asomado (en rejillas varias comparten fila).
    let leidas = 0;
    let actual = -1;
    arts.forEach((a, i) => {
      const r = a.getBoundingClientRect();
      if (r.bottom < umbral) leidas = i + 1;
      else if (actual < 0 && r.top < umbral) actual = i;
    });
    if (alFinal) {
      leidas = arts.length - 1;
      actual = arts.length - 1;
    }
    // Visible solo cuando ya se está leyendo, no sobre la cabecera.
    barra.classList.toggle("is-visible", scrollY > 120);
    marcas.forEach((m, i) => {
      m.classList.toggle("is-leida", i < leidas && i !== actual);
      m.classList.toggle("is-actual", i === actual);
    });
  }
  const pedir = () => {
    if (!pendiente) {
      pendiente = true;
      requestAnimationFrame(actualizar);
    }
  };
  addEventListener("scroll", pedir, { passive: true });
  addEventListener("resize", pedir);
  construir();
}

/* ---------- Tipografía ---------- */

// Las fuentes y su carga están en el <head> (base.njk), para aplicarlas antes
// de pintar; aquí solo se elige y se recuerda.
function initTipografia() {
  const menu = document.querySelector(".tipo");
  if (!menu) return;
  const ops = [...menu.querySelectorAll(".tipo__op")];
  const html = document.documentElement;
  const pintar = () => {
    const actual = html.dataset.fuente || "clasica";
    for (const o of ops) o.setAttribute("aria-pressed", String(o.dataset.fuente === actual));
  };
  pintar();
  // Al abrir, se cargan todas para que cada opción se vea con su letra.
  menu.addEventListener("toggle", () => {
    if (menu.open) for (const f of Object.keys(window.FUENTES || {})) window.cargarFuente(f);
  });
  menu.addEventListener("click", (e) => {
    const o = e.target.closest(".tipo__op");
    if (!o) return;
    const f = o.dataset.fuente;
    if (f === "clasica") delete html.dataset.fuente;
    else html.dataset.fuente = f;
    try {
      localStorage.setItem("fuente", f);
    } catch {}
    pintar();
    menu.open = false;
  });
}

/* ---------- Cursor retro ---------- */

// La flecha (o la manita sobre lo pulsable) es un <img> que sigue al ratón.
// Solo con ratón y sin preferencia de movimiento reducido; sin JS queda el
// cursor del sistema.
function initCursor() {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches || reducirMovimiento.matches) return;
  // Ruta de las imágenes a partir de la hoja propia (no la primera: si hay
  // tipografía elegida, la de Google Fonts va antes).
  const hoja = document.querySelector('link[href*="css/diario.css"]');
  if (!hoja) return;
  const base = new URL("../img/", hoja.href).href;
  const crear = (nombre) => {
    const img = document.createElement("img");
    img.src = `${base}cursor-${nombre}.svg`;
    img.alt = "";
    img.className = "cursor-retro__el";
    img.setAttribute("aria-hidden", "true");
    document.body.append(img);
    return img;
  };
  const flecha = crear("flecha");
  const mano = crear("mano");
  // Punta de cada dibujo: la flecha en su esquina, la manita en el dedo.
  const punta = new Map([[flecha, [0, 0]], [mano, [11, 0]]]);
  const pulsable = "a, button, summary, label, [role='button']";
  const sistema = "input, textarea, select, dialog, dialog *";
  let x = 0;
  let y = 0;
  let actual = null;
  let pendiente = false;

  function pintar() {
    pendiente = false;
    for (const el of [flecha, mano]) el.classList.toggle("is-visible", el === actual);
    if (!actual) return;
    const [dx, dy] = punta.get(actual);
    actual.style.transform = `translate(${x - dx}px, ${y - dy}px)`;
  }
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    x = e.clientX;
    y = e.clientY;
    const t = e.target instanceof Element ? e.target : null;
    actual = !t || t.closest(sistema) ? null : t.closest(pulsable) ? mano : flecha;
    if (!pendiente) {
      pendiente = true;
      requestAnimationFrame(pintar);
    }
  });
  // Fuera de la ventana no se dibuja nada.
  document.documentElement.addEventListener("mouseleave", () => {
    actual = null;
    pintar();
  });
  // El cursor del sistema solo se oculta cuando los dos dibujos han cargado;
  // si alguno falla, se queda el del sistema.
  Promise.all([flecha.decode(), mano.decode()])
    .then(() => document.documentElement.classList.add("cursor-retro"))
    .catch(() => {
      flecha.remove();
      mano.remove();
    });
}

initTema();
initTipografia();
initIndicador();
initProgreso();
initCursor();
