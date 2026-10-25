// Interacciones de la interfaz, inspiradas en bloques de Bencho (bencho.dev):
// interruptor de tema (LiquidToggle), menú con «Más» y panel lateral,
// indicador deslizante del menú (GooTabs),
// progreso de lectura por marcas (ProgressTicks), selector de tipografía,
// cursor retro pixelado, fondo de hebras y sonidos de interfaz.
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
  // Solo los elementos de la fila: los enlaces dentro de «Más» se marcan en
  // su botón, no donde están dentro del desplegable.
  const mas = nav.querySelector(".masthead__mas-boton");
  const enlaces = [...nav.querySelectorAll(":scope > a"), mas].filter(Boolean);
  const ind = document.createElement("span");
  ind.className = "masthead__indicador";
  ind.setAttribute("aria-hidden", "true");
  nav.append(ind);
  nav.classList.add("has-indicador");

  const activo = () => enlaces.find((a) => a.classList.contains("is-active") && !a.hidden);
  function mover(a) {
    if (!a || a.hidden) {
      ind.style.opacity = "0";
      return;
    }
    // Por rectángulos y no por offsetLeft: el botón de «Más» vive en un
    // contenedor posicionado y su offset no sería relativo al menú.
    const n = nav.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    ind.style.opacity = "1";
    ind.style.width = `${r.width}px`;
    ind.style.transform = `translate(${r.left - n.left - nav.clientLeft}px, ${r.bottom - n.top - nav.clientTop + 4}px)`;
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

/* ---------- Menú: «Más» en escritorio, panel lateral en móvil ---------- */

function initMenu() {
  const nav = document.querySelector(".masthead__nav");
  const mas = nav?.querySelector(".masthead__mas");
  const masBoton = mas?.querySelector(".masthead__mas-boton");
  const abrir = document.querySelector(".menu-boton");
  const cerrar = nav?.querySelector(".menu-cerrar");
  if (!nav || !mas || !masBoton || !abrir || !cerrar) return;
  const html = document.documentElement;
  const movil = matchMedia("(max-width: 600px)");

  nav.classList.add("has-menu");
  for (const b of [masBoton, abrir, cerrar]) b.hidden = false;

  function desplegar(si) {
    masBoton.setAttribute("aria-expanded", String(si));
    mas.classList.toggle("is-abierto", si);
  }
  masBoton.addEventListener("click", () => desplegar(masBoton.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", (e) => {
    if (!mas.contains(e.target)) desplegar(false);
  });
  mas.addEventListener("focusout", (e) => {
    if (!mas.contains(e.relatedTarget)) desplegar(false);
  });

  const fondo = document.createElement("div");
  fondo.className = "menu-fondo";
  nav.before(fondo);

  function panel(si) {
    html.classList.toggle("menu-abierto", si);
    abrir.setAttribute("aria-expanded", String(si));
    if (si) cerrar.focus();
  }
  abrir.addEventListener("click", () => panel(true));
  cerrar.addEventListener("click", () => {
    panel(false);
    abrir.focus();
  });
  fondo.addEventListener("click", () => panel(false));

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (html.classList.contains("menu-abierto")) {
      panel(false);
      abrir.focus();
    } else if (mas.classList.contains("is-abierto")) {
      desplegar(false);
      masBoton.focus();
    }
  });
  // Al cruzar el corte de móvil, nada se queda abierto en el otro diseño.
  movil.addEventListener("change", () => {
    panel(false);
    desplegar(false);
  });
}

/* ---------- Progreso de lectura por marcas ---------- */

function initProgreso() {
  const lista = () => [...document.querySelectorAll(".lead, .story")];
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

/* ---------- Fondo de hebras ---------- */

// Líneas finas que siguen un campo de ruido, dibujadas una sola vez y quietas.
// Monocromo con la tinta del tema y tenues, para no competir con la lectura.
// Se repinta solo al cambiar el tema o el ancho.
function initFondo() {
  const canvas = document.createElement("canvas");
  canvas.className = "fondo";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Ruido de valor suavizado con semilla fija: el dibujo es el mismo en cada visita.
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const ruido = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  function pintar() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = innerWidth, H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // La tinta sale del CSS para seguir al tema sin duplicar la paleta aquí.
    const m = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim().match(/^#([0-9a-f]{6})$/i);
    const n = m ? parseInt(m[1], 16) : 0;
    ctx.strokeStyle = `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},0.07)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Pocas hebras por área: el fondo acompaña, no llena.
    const total = Math.round((W * H) / 12000);
    for (let i = 0; i < total; i++) {
      let x = hash(i, 1) * W;
      let y = hash(i, 2) * H;
      ctx.moveTo(x, y);
      for (let p = 0, largo = 80 + hash(i, 3) * 140; p < largo; p++) {
        const ang = ruido(x * 0.0025, y * 0.0025) * Math.PI * 4;
        x += Math.cos(ang) * 2;
        y += Math.sin(ang) * 2;
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  document.body.prepend(canvas);
  pintar();
  new MutationObserver(pintar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", pintar);
  // En móvil la barra de direcciones cambia el alto al hacer scroll: solo se
  // repinta si cambia el ancho.
  let ancho = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === ancho) return;
    ancho = innerWidth;
    pintar();
  });
}

/* ---------- Sonidos ---------- */

// Apagados por defecto: los enciende el botón del altavoz y se recuerda. Se
// sintetizan con Web Audio (sin ficheros). Todo clic suena y cada acción tiene
// su sonido; todos usan la escala pentatónica de Do, la misma de la música de
// fondo (js/musica.js), así que nunca desentonan con ella. Cada nota varía un
// poco de afinación para que repetir un gesto no suene a máquina.
function initSonido() {
  const btn = document.querySelector(".sonido");
  if (!btn || !window.AudioContext) return;
  let ctx = null;
  let musica = null;
  let activo = false;
  try {
    activo = localStorage.getItem("sonido") === "on";
  } catch {}

  // Pentatónica de Do (do re mi sol la), de la octava 5 a la 7, en Hz. Nada
  // por debajo de ~500 Hz: los altavoces de portátil y móvil no lo reproducen.
  const NOTAS = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093];
  // Volumen general de los sonidos: cada uno lleva el suyo relativo a este.
  const VOLUMEN = 0.45;
  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

  // Cada sonido devuelve sus notas [frecuencia, inicio s, duración s] y su
  // timbre; los que llevan azar cambian en cada pulsación.
  const SONIDOS = {
    // Cada sección tiene su nota: cambiar de sección suena a escala.
    seccion: (i) => ({ notas: [[NOTAS[5 + (i % 6)], 0, 0.09]], onda: "sine", vol: 0.16 }),
    enlace: () => ({ notas: [[azar(NOTAS.slice(6, 9)), 0, 0.05]], onda: "triangle", vol: 0.11 }),
    fuera: () => ({ notas: [[784, 0, 0.06], [1175, 0.05, 0.06], [1568, 0.1, 0.09]], onda: "sine", vol: 0.12 }),
    toque: () => ({ notas: [[azar(NOTAS.slice(0, 5)), 0, 0.05]], onda: "sine", vol: 0.08 }),
    abrir: () => ({ notas: [[659, 0, 0.07], [988, 0.05, 0.1]], onda: "triangle", vol: 0.12 }),
    cerrar: () => ({ notas: [[988, 0, 0.06], [659, 0.045, 0.09]], onda: "triangle", vol: 0.1 }),
    claro: () => ({ notas: [[784, 0, 0.08], [1175, 0.06, 0.08], [1568, 0.12, 0.14]], onda: "sine", vol: 0.13 }),
    oscuro: () => ({ notas: [[1568, 0, 0.08], [1175, 0.06, 0.08], [784, 0.12, 0.16]], onda: "sine", vol: 0.13 }),
    fuente: (i) => ({ notas: [[NOTAS[2 + i], 0, 0.06], [NOTAS[4 + i], 0.04, 0.08]], onda: "square", vol: 0.04 }),
    pagina: (dir) => ({ notas: [[dir > 0 ? 880 : 1047, 0, 0.04], [dir > 0 ? 1047 : 880, 0.035, 0.05]], onda: "triangle", vol: 0.1 }),
    tecla: () => ({ notas: [[azar(NOTAS.slice(7)), 0, 0.025]], onda: "square", vol: 0.025 }),
    hecho: () => ({ notas: [[1047, 0, 0.06], [1319, 0.06, 0.06], [1568, 0.12, 0.16]], onda: "sine", vol: 0.12 }),
    encender: () => ({ notas: [[523, 0, 0.1], [659, 0.08, 0.1], [784, 0.16, 0.1], [1047, 0.24, 0.22]], onda: "sine", vol: 0.12 }),
    apagar: () => ({ notas: [[1047, 0, 0.08], [784, 0.07, 0.08], [523, 0.14, 0.18]], onda: "sine", vol: 0.1 }),
  };

  // El contexto se crea y se despierta en el primer gesto: así el primer
  // sonido no llega tarde y la música puede arrancar.
  function despertar() {
    if (!activo) return;
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    if (!musica) arrancarMusica();
  }
  document.addEventListener("pointerdown", despertar, true);
  document.addEventListener("keydown", despertar, true);

  function sonar(nombre, arg, forzar = false) {
    if ((!activo && !forzar) || !SONIDOS[nombre]) return;
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const s = SONIDOS[nombre](arg);
    const desafinar = 1 + (Math.random() - 0.5) * 0.03;
    const t0 = ctx.currentTime + 0.005;
    for (const [f, inicio, dur] of s.notas) {
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = s.onda;
      osc.frequency.value = f * desafinar;
      // Ataque rápido y caída exponencial: suena a clic, no a pitido.
      gan.gain.setValueAtTime(0.0001, t0 + inicio);
      gan.gain.exponentialRampToValueAtTime(s.vol * VOLUMEN, t0 + inicio + 0.005);
      gan.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + dur);
      osc.connect(gan).connect(ctx.destination);
      osc.start(t0 + inicio);
      osc.stop(t0 + inicio + dur + 0.02);
    }
  }

  // La música vive en su propio fichero y solo se descarga con el sonido
  // encendido: quien no lo activa no paga sus bytes.
  function arrancarMusica() {
    musica = import(btn.dataset.musica)
      .then((m) => {
        m.iniciar(ctx);
        return m;
      })
      .catch(() => null);
  }
  function pararMusica() {
    musica?.then((m) => m?.parar());
    musica = null;
  }

  // Con el sonido ya encendido de antes, la música se prepara al cargar. Si el
  // navegador no deja sonar sin un gesto, arranca con el primer clic o tecla.
  if (activo) despertar();

  const pintar = () => {
    btn.setAttribute("aria-pressed", String(activo));
    btn.title = activo ? "Silenciar sonidos" : "Activar sonidos";
  };
  pintar();
  btn.hidden = false;
  btn.addEventListener("click", () => {
    activo = !activo;
    try {
      localStorage.setItem("sonido", activo ? "on" : "off");
    } catch {}
    pintar();
    if (activo) {
      despertar();
      sonar("encender");
    } else {
      sonar("apagar", undefined, true);
      pararMusica();
    }
  });

  // Con la pestaña oculta el audio se duerme; al volver, sigue donde estaba.
  document.addEventListener("visibilitychange", () => {
    if (!ctx || !activo) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  // Un enlace interno cambia de página al instante y corta el sonido: se le
  // da el tiempo justo para que se oiga antes de navegar.
  const navegaAqui = (a, e) =>
    a.href && !a.hasAttribute("download") && (!a.target || a.target === "_self")
    && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
    && a.origin === location.origin && !(a.pathname === location.pathname && a.hash);

  const secciones = [...document.querySelectorAll(".masthead__nav a:not(.masthead__buscar)")];
  const fuentes = [...document.querySelectorAll(".tipo__op")];

  // Va en burbuja, después de los manejadores de cada control: el tema ya ha
  // cambiado, los desplegables ya conocen su estado y la búsqueda ya ha
  // cancelado su enlace.
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!activo || !t || t.closest(".sonido")) return;
    const a = t.closest("a");
    const desplegable = t.closest("summary")?.parentElement;
    if (t.closest(".tema")) sonar(document.documentElement.dataset.theme === "dark" ? "oscuro" : "claro");
    else if (t.closest("[data-paleta]")) sonar("abrir");
    else if (t.closest(".share__copy")) sonar("hecho");
    else if (t.closest(".tipo__op")) sonar("fuente", fuentes.indexOf(t.closest(".tipo__op")));
    // El calendario repinta su cabecera al cambiar de mes: el botón ya no
    // está en la página, pero conserva su etiqueta.
    else if (t.closest(".calendario__nav")) sonar("pagina", t.closest(".calendario__nav").getAttribute("aria-label") === "Mes anterior" ? -1 : 1);
    else if (desplegable instanceof HTMLDetailsElement) sonar(desplegable.open ? "cerrar" : "abrir");
    else if (t.closest(".masthead__mas-boton, .menu-boton")) sonar(t.closest("[aria-expanded]")?.getAttribute("aria-expanded") === "true" ? "abrir" : "cerrar");
    else if (t.closest(".menu-cerrar")) sonar("cerrar");
    else if (a && secciones.includes(a)) sonar("seccion", secciones.indexOf(a));
    else if (a && a.target === "_blank") sonar("fuera");
    else if (t.closest("a, button, summary, label, input, select")) sonar("enlace");
    else sonar("toque");

    if (a && !e.defaultPrevented && navegaAqui(a, e)) {
      e.preventDefault();
      setTimeout(() => location.assign(a.href), 90);
    }
  });
  // Escribir en la búsqueda suena a teclas; cerrarla, a cerrar.
  document.addEventListener("input", (e) => {
    if (e.target instanceof Element && e.target.closest(".paleta__input")) sonar("tecla");
  });
  document.addEventListener("close", (e) => {
    if (e.target instanceof HTMLDialogElement && e.target.classList.contains("paleta")) sonar("cerrar");
  }, true);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") sonar("abrir");
  });
}

initTema();
initTipografia();
initMenu();
initIndicador();
initProgreso();
initCursor();
initFondo();
initSonido();
