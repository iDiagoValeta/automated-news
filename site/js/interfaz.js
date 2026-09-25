// Interacciones de la interfaz, inspiradas en bloques de Bencho (bencho.dev):
// interruptor de tema (LiquidToggle), indicador deslizante del menú (GooTabs),
// progreso de lectura por marcas (ProgressTicks) y filtro por categoría con
// pastilla deslizante (MagneticSelect). Todo es mejora progresiva: sin JS la
// página funciona igual.

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
  const lista = () => [...document.querySelectorAll(".lead, .story, .repo")].filter((a) => !a.classList.contains("is-oculto"));
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
  document.addEventListener("filtrado", construir);
  construir();
}

/* ---------- Filtro por categoría ---------- */

function initFiltro() {
  const edicion = document.querySelector(".edicion");
  if (!edicion) return;
  const arts = [...edicion.querySelectorAll("[data-categoria]")];
  const cuenta = new Map();
  for (const a of arts) {
    const c = a.dataset.categoria;
    if (c) cuenta.set(c, (cuenta.get(c) || 0) + 1);
  }
  if (cuenta.size < 2) return;

  const grupo = document.createElement("div");
  grupo.className = "filtro";
  grupo.setAttribute("role", "group");
  grupo.setAttribute("aria-label", "Filtrar noticias por categoría");
  const pastilla = document.createElement("span");
  pastilla.className = "filtro__pastilla";
  pastilla.setAttribute("aria-hidden", "true");
  grupo.append(pastilla);

  const estado = document.createElement("p");
  estado.className = "visually-hidden";
  estado.setAttribute("role", "status");

  const opciones = [["", "Todas", arts.length], ...[...cuenta].map(([c, n]) => [c, c, n])];
  const botones = opciones.map(([valor, texto, n]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "filtro__op";
    b.dataset.valor = valor;
    b.setAttribute("aria-pressed", String(valor === ""));
    b.append(texto);
    const num = document.createElement("span");
    num.className = "filtro__n";
    num.textContent = String(n);
    b.append(num);
    grupo.append(b);
    return b;
  });

  function colocar(b) {
    pastilla.style.width = `${b.offsetWidth}px`;
    pastilla.style.height = `${b.offsetHeight}px`;
    pastilla.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
  }
  const elegido = () => botones.find((b) => b.getAttribute("aria-pressed") === "true");

  function elegir(b) {
    if (b === elegido()) return;
    for (const o of botones) o.setAttribute("aria-pressed", String(o === b));
    colocar(b);
    const valor = b.dataset.valor;
    let visibles = 0;
    for (const a of arts) {
      const ok = !valor || a.dataset.categoria === valor;
      a.classList.toggle("is-oculto", !ok);
      if (ok) {
        visibles += 1;
        if (!reducirMovimiento.matches) {
          // Reinicia la animación de entrada para las que aparecen.
          a.style.animation = "none";
          void a.offsetWidth;
          a.style.animation = "";
        }
      }
    }
    estado.textContent = valor
      ? `${visibles} ${visibles === 1 ? "noticia" : "noticias"} de ${valor}.`
      : `Mostrando las ${visibles} noticias.`;
    document.dispatchEvent(new Event("filtrado"));
  }

  grupo.addEventListener("click", (e) => {
    const b = e.target.closest(".filtro__op");
    if (b) elegir(b);
  });
  // Flechas para moverse entre opciones, como una barra de herramientas.
  grupo.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = botones.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const sig = botones[(i + (e.key === "ArrowRight" ? 1 : -1) + botones.length) % botones.length];
    sig.focus();
  });

  edicion.before(grupo, estado);
  colocar(elegido());
  requestAnimationFrame(() => requestAnimationFrame(() => grupo.classList.add("is-listo")));
  addEventListener("resize", () => colocar(elegido()));
  document.fonts?.ready.then(() => colocar(elegido()));
}

initTema();
initIndicador();
initFiltro();
initProgreso();
