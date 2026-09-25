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
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("is-copied");
    notificar("Texto copiado al portapapeles");
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
      notificar("Texto copiado al portapapeles");
      setTimeout(() => btn.classList.remove("is-copied"), 1600);
    } catch {
      /* nada más que hacer */
    }
    document.body.removeChild(ta);
  }
});

// En pantallas pequeñas con hoja de compartir nativa, un único botón sustituye
// a los cuatro (publicar/copiar en X y LinkedIn): menos ruido en cada noticia.
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
