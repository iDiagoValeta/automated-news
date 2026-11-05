// Interacciones de la interfaz, inspiradas en bloques de Bencho (bencho.dev):
// interruptor de tema (LiquidToggle), menú con «Más» y panel lateral,
// indicador deslizante del menú (GooTabs),
// progreso de lectura por marcas (ProgressTicks) y sonidos de interfaz.
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

/* ---------- Aviso de edición antigua ---------- */

// El sitio es estático: solo el navegador sabe qué día es. La edición sale a
// mediodía, así que la de ayer es normal por la mañana; a partir de dos días
// sin edición nueva se avisa, para que nadie lea lo de la semana pasada como
// si fuera de hoy. Se cuenta en la zona horaria de Madrid, la del pipeline.
function initAviso() {
  const cab = document.querySelector(".fechario[data-ultima]");
  const aviso = cab?.querySelector(".fechario__aviso");
  if (!aviso) return;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  const dias = Math.round((Date.parse(hoy) - Date.parse(cab.dataset.ultima)) / 86400000);
  if (!(dias >= 2)) return;
  aviso.textContent = `No hay edición nueva desde hace ${dias} días.`;
  aviso.hidden = false;
}

/* ---------- Atajo de búsqueda según el sistema ---------- */

// ⌘ solo existe en el Mac; en Linux y Windows el atajo es Ctrl K.
function initAtajo() {
  const kbd = document.querySelector(".masthead__buscar kbd");
  if (kbd && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) kbd.textContent = "Ctrl K";
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
  let bus = null;
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
    pagina: (dir) => ({ notas: [[dir > 0 ? 880 : 1047, 0, 0.04], [dir > 0 ? 1047 : 880, 0.035, 0.05]], onda: "triangle", vol: 0.1 }),
    tecla: () => ({ notas: [[azar(NOTAS.slice(7)), 0, 0.025]], onda: "triangle", vol: 0.03 }),
    hecho: () => ({ notas: [[1047, 0, 0.06], [1319, 0.06, 0.06], [1568, 0.12, 0.16]], onda: "sine", vol: 0.12 }),
    encender: () => ({ notas: [[523, 0, 0.1], [659, 0.08, 0.1], [784, 0.16, 0.1], [1047, 0.24, 0.22]], onda: "sine", vol: 0.12 }),
    apagar: () => ({ notas: [[1047, 0, 0.08], [784, 0.07, 0.08], [523, 0.14, 0.18]], onda: "sine", vol: 0.1 }),
  };

  // El contexto se crea y se despierta en el primer gesto: así el primer
  // sonido no llega tarde y la música puede arrancar.
  // Limitador y latencia "playback": sin ellos el móvil petardea.
  function contexto() {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: "playback" });
      bus = ctx.createDynamicsCompressor();
      bus.threshold.value = -14;
      bus.ratio.value = 8;
      bus.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }
  function despertar() {
    if (!activo) return;
    contexto();
    if (!musica) arrancarMusica();
  }
  document.addEventListener("pointerdown", despertar, true);
  document.addEventListener("keydown", despertar, true);

  function sonar(nombre, arg, forzar = false) {
    if ((!activo && !forzar) || !SONIDOS[nombre]) return;
    contexto();
    const s = SONIDOS[nombre](arg);
    const desafinar = 1 + (Math.random() - 0.5) * 0.03;
    const t0 = ctx.currentTime + 0.005;
    for (const [f, inicio, dur] of s.notas) {
      const osc = ctx.createOscillator();
      const gan = ctx.createGain();
      osc.type = s.onda;
      osc.frequency.value = f * desafinar;
      // Empieza y acaba en cero: un salto de nivel suena a chasquido.
      gan.gain.setValueAtTime(0, t0 + inicio);
      gan.gain.linearRampToValueAtTime(s.vol * VOLUMEN, t0 + inicio + 0.008);
      gan.gain.setTargetAtTime(0, t0 + inicio + 0.008, dur / 6);
      osc.connect(gan).connect(bus);
      osc.start(t0 + inicio);
      osc.stop(t0 + inicio + dur + 0.05);
    }
  }

  // La música vive en su propio fichero y solo se descarga con el sonido
  // encendido: quien no lo activa no paga sus bytes.
  function arrancarMusica() {
    musica = import(btn.dataset.musica)
      .then((m) => {
        m.iniciar(ctx, bus);
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
initAviso();
initAtajo();
initMenu();
initIndicador();
initProgreso();
initSonido();
