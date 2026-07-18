// Calendario de fechas disponibles. Renderiza un mes con los días que tienen
// edición como enlaces (el resto quedan deshabilitados), abre en el día actual
// y permite navegar entre meses dentro del rango publicado.
(function () {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var DIAS = ["L", "M", "X", "J", "V", "S", "D"];

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function ym(y, m) { return y + "-" + pad(m); }

  function initCalendario(cal) {
    var datosEl = cal.querySelector(".calendario__datos");
    if (!datosEl) return;
    var datos;
    try { datos = JSON.parse(datosEl.textContent); } catch (e) { return; }
    if (!datos.length) return;

    var disp = {};
    datos.forEach(function (x) { disp[x.d] = x.u; });
    var fechas = datos.map(function (x) { return x.d; }).sort();
    var minYM = fechas[0].slice(0, 7);
    var maxYM = fechas[fechas.length - 1].slice(0, 7);
    var actual = cal.getAttribute("data-actual") || fechas[fechas.length - 1];

    var year = Number(actual.slice(0, 4));
    var month = Number(actual.slice(5, 7)); // 1-12

    var caja = document.createElement("div");
    caja.className = "calendario__caja";
    cal.appendChild(caja);

    function render() {
      var cur = ym(year, month);
      caja.innerHTML = "";

      var head = document.createElement("div");
      head.className = "calendario__cabecera";

      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "calendario__nav";
      prev.setAttribute("aria-label", "Mes anterior");
      prev.textContent = "‹";
      prev.disabled = cur <= minYM;
      prev.addEventListener("click", function () {
        month--; if (month < 1) { month = 12; year--; } render();
      });

      var titulo = document.createElement("span");
      titulo.className = "calendario__titulo";
      titulo.textContent = cap(MESES[month - 1]) + " " + year;

      var next = document.createElement("button");
      next.type = "button";
      next.className = "calendario__nav";
      next.setAttribute("aria-label", "Mes siguiente");
      next.textContent = "›";
      next.disabled = cur >= maxYM;
      next.addEventListener("click", function () {
        month++; if (month > 12) { month = 1; year++; } render();
      });

      head.appendChild(prev);
      head.appendChild(titulo);
      head.appendChild(next);
      caja.appendChild(head);

      var grid = document.createElement("div");
      grid.className = "calendario__grid";

      DIAS.forEach(function (d) {
        var c = document.createElement("span");
        c.className = "calendario__dow";
        c.textContent = d;
        grid.appendChild(c);
      });

      var primero = new Date(Date.UTC(year, month - 1, 1));
      var offset = (primero.getUTCDay() + 6) % 7; // lunes = 0
      for (var i = 0; i < offset; i++) {
        var vacia = document.createElement("span");
        vacia.className = "calendario__celda calendario__celda--vacia";
        grid.appendChild(vacia);
      }

      var diasMes = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (var d = 1; d <= diasMes; d++) {
        var fecha = ym(year, month) + "-" + pad(d);
        if (disp[fecha]) {
          var a = document.createElement("a");
          a.className = "calendario__celda calendario__celda--disp";
          a.href = disp[fecha];
          a.textContent = d;
          if (fecha === actual) a.className += " is-actual";
          grid.appendChild(a);
        } else {
          var off = document.createElement("span");
          off.className = "calendario__celda calendario__celda--off";
          off.textContent = d;
          grid.appendChild(off);
        }
      }

      caja.appendChild(grid);
    }

    render();
  }

  var cals = document.querySelectorAll(".calendario");
  for (var i = 0; i < cals.length; i++) initCalendario(cals[i]);

  // Cerrar el desplegable al hacer clic fuera o pulsar Escape.
  document.addEventListener("click", function (e) {
    var abiertos = document.querySelectorAll("details.cal-menu[open]");
    for (var j = 0; j < abiertos.length; j++) {
      if (!abiertos[j].contains(e.target)) abiertos[j].removeAttribute("open");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var abiertos = document.querySelectorAll("details.cal-menu[open]");
    for (var j = 0; j < abiertos.length; j++) abiertos[j].removeAttribute("open");
  });
})();
