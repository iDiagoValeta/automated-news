// Inclinación sutil de tarjetas al seguir el cursor (TiltCard de Bencho).
// Solo con ratón y sin preferencia de movimiento reducido.
if (matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches) {
  const MAX = 4;
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.(".repo");
    if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--rx", `${(-y * MAX).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${(x * MAX).toFixed(2)}deg`);
    card.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    card.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  });
  document.addEventListener("pointerout", (e) => {
    const card = e.target.closest?.(".repo");
    if (card && !card.contains(e.relatedTarget)) {
      card.style.removeProperty("--rx");
      card.style.removeProperty("--ry");
    }
  });
}
