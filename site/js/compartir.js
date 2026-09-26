// Al recargar (o volver), empezar arriba en vez de restaurar la posición previa.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.addEventListener("pageshow", () => window.scrollTo(0, 0));

// Aviso flotante (Notify de Bencho): confirma la acción sin mover el layout.
let toast, toastT;
function notificar(msg) {
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("is-visible");
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

// Copia al portapapeles el texto social (fallback si el intent no precarga).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".share__copy");
  if (!btn) return;
  const text = btn.getAttribute("data-copy");
  if (!text) return;
  const aviso = `Texto para ${btn.dataset.red} copiado`;
  btn.closest("details")?.removeAttribute("open");
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("is-copied");
    notificar(aviso);
    setTimeout(() => btn.classList.remove("is-copied"), 1600);
  } catch {
    // Fallback para navegadores sin permiso de portapapeles.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      btn.classList.add("is-copied");
      notificar(aviso);
      setTimeout(() => btn.classList.remove("is-copied"), 1600);
    } catch {
      /* nada más que hacer */
    }
    document.body.removeChild(ta);
  }
});

// En pantallas pequeñas con hoja de compartir nativa, un único botón sustituye
// al menú de cuatro acciones (publicar/copiar en X y LinkedIn): menos ruido en cada noticia.
const movil = matchMedia("(max-width: 600px)");
function modoNativo() {
  const usar = Boolean(navigator.share) && movil.matches;
  document.documentElement.classList.toggle("share-nativo", usar);
  for (const b of document.querySelectorAll(".share__nativo")) b.hidden = !usar;
}
modoNativo();
movil.addEventListener("change", modoNativo);
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".share__nativo");
  if (!btn) return;
  const art = btn.closest("article");
  const enlace = art?.querySelector("h2 a, h3 a");
  try {
    const text = btn.dataset.shareText || "";
    const datos = { title: enlace?.textContent?.trim(), text };
    // Si el texto ya lleva el enlace, no duplicarlo.
    if (enlace && !text.includes(enlace.href)) datos.url = enlace.href;
    await navigator.share(datos);
  } catch {
    /* cancelado por el usuario */
  }
});

// Animación de apertura (CSS .is-abriendo): se quita al cerrar para que
// vuelva a dispararse en la siguiente apertura. "toggle" no burbujea.
document.addEventListener(
  "toggle",
  (e) => {
    if (e.target instanceof HTMLDetailsElement) e.target.classList.toggle("is-abriendo", e.target.open);
  },
  true,
);

// Menús desplegables (compartir, calendario, tipografía): se cierran al pulsar
// fuera, al elegir un enlace o con Escape, y solo hay uno abierto a la vez.
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll("details[open]")) {
    if (!d.contains(e.target) || e.target.closest(".share__item[href]")) d.removeAttribute("open");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const d of document.querySelectorAll("details[open]")) {
    d.removeAttribute("open");
    d.querySelector("summary")?.focus();
  }
});
