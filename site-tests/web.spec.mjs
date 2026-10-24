// Test de funcionalidad y eficiencia de la web sobre _site/ (hay que construir antes:
// `pnpm run test:web`). Necesita Chromium, por eso el fichero NO se llama *.test.mjs:
// así `pnpm test` (node --test sin argumentos) no lo descubre y sigue sin navegador.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { hasShareText } from "../site/_11ty/share.js";
import site from "../site/_data/site.js";
import { tokenize } from "../site/_11ty/search.js";
import configurarEleventy from "../eleventy.config.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(aqui, "../_site");
const PREFIJO = "/automated-news/";

// pathPrefix real del build: se saca de la configuración de Eleventy, no de
// site.url, para que un site.url sin prefijo no pase por bueno.
function pathPrefixEleventy() {
  // Doble de la API de Eleventy: cualquier método que use el config (también
  // addCollection o addShortcode) existe y no hace nada, para que el suite no
  // reviente al importar por una función que aquí no interesa.
  const config = new Proxy({}, { get: () => () => {} });
  const { pathPrefix } = configurarEleventy(config);
  assert.ok(typeof pathPrefix === "string" && pathPrefix.startsWith("/") && pathPrefix.endsWith("/"),
    `pathPrefix inesperado en eleventy.config.mjs: ${pathPrefix}`);
  return pathPrefix;
}

// Origen público del build: origen de site.url más el pathPrefix. Los XML
// deben usar esta base, no la que salga de site.url a solas.
const BASE = `${new URL(site.url).origin}${pathPrefixEleventy()}`;
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
const COMPRIMIBLES = /^(text\/|application\/(json|xml)|image\/svg)/;

let servidor, origen, navegador;
// Bytes realmente escritos al cliente (ya comprimidos) desde el último reinicio.
const trafico = { bytes: 0, peticiones: 0 };

// Imita GitHub Pages: sirve _site/ bajo /automated-news/ y comprime con gzip los tipos texto.
function crearServidor() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let ruta = decodeURIComponent(url.pathname);
    if (!ruta.startsWith(PREFIJO)) { res.writeHead(404).end("no encontrado"); return; }
    let fichero = path.join(RAIZ, ruta.slice(PREFIJO.length));
    if (!fichero.startsWith(RAIZ)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(fichero) && fs.statSync(fichero).isDirectory()) fichero = path.join(fichero, "index.html");
    if (!fs.existsSync(fichero)) { res.writeHead(404, { "content-type": "text/plain" }).end("no encontrado"); return; }
    const tipo = TIPOS[path.extname(fichero)] || "application/octet-stream";
    let cuerpo = fs.readFileSync(fichero);
    const cabeceras = { "content-type": tipo };
    if (COMPRIMIBLES.test(tipo) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      cuerpo = zlib.gzipSync(cuerpo);
      cabeceras["content-encoding"] = "gzip";
    }
    cabeceras["content-length"] = cuerpo.length;
    trafico.bytes += cuerpo.length;
    trafico.peticiones += 1;
    res.writeHead(200, cabeceras).end(cuerpo);
  });
}

// Orden: CHROMIUM_PATH, la ruta que deja `playwright-core install chromium`
// (chromium.executablePath()) y, si no existe, un escaneo de ~/.cache/ms-playwright
// (Chromium completo o headless shell).
function ejecutableChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const oficial = chromium.executablePath();
  if (oficial && fs.existsSync(oficial)) return oficial;
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  const versiones = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d))
        .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])
          || a.length - b.length)
    : [];
  for (const v of versiones) {
    for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome",
      "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-headless-shell-linux/chrome-headless-shell"]) {
      const p = path.join(cache, v, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("No hay Chromium: define CHROMIUM_PATH o instala uno con playwright-core");
}

before(async () => {
  assert.ok(fs.existsSync(path.join(RAIZ, "index.html")), "falta _site/: ejecuta eleventy antes");
  servidor = crearServidor();
  await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
  origen = `http://127.0.0.1:${servidor.address().port}`;
  navegador = await chromium.launch({ executablePath: ejecutableChromium(), args: ["--no-sandbox"] });
});

after(async () => {
  await navegador?.close();
  servidor?.closeAllConnections();
  await new Promise((r) => (servidor ? servidor.close(r) : r()));
});

// Abre una página recogiendo errores de consola y respuestas fallidas del mismo origen.
// `preparar` corre antes de navegar (p. ej. para interceptar una petición).
async function abrir(ruta, opciones = {}, preparar) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, ...opciones });
  const pagina = await contexto.newPage();
  const problemas = [];
  pagina.on("console", (m) => {
    if (m.type() !== "error") return;
    // La ubicación del mensaje lleva la URL del recurso que falló; sin ella no
    // se puede distinguir el índice bloqueado de cualquier otro recurso caído.
    const url = m.location().url;
    problemas.push(url ? `consola: ${m.text()} (${url})` : `consola: ${m.text()}`);
  });
  pagina.on("pageerror", (e) => problemas.push(`excepción: ${e.message}`));
  pagina.on("requestfailed", (r) => problemas.push(`fallo: ${r.url()}`));
  pagina.on("response", (r) => {
    if (r.url().startsWith(origen) && r.status() >= 400) problemas.push(`${r.status()} ${r.url()}`);
  });
  if (preparar) await preparar(pagina);
  const resp = await pagina.goto(`${origen}${PREFIJO}${ruta}`, { waitUntil: "load" });
  return { contexto, pagina, problemas, resp };
}

// Fechas de las ediciones de data/, de la más reciente a la más antigua.
// «fecha|título» de cada lectura publicada en data/, para saber qué sección le
// toca a un resultado de búsqueda sin fiarse del índice que se está probando.
function lecturasPublicadas() {
  const dir = path.join(aqui, "../data");
  const claves = new Set();
  for (const fecha of edicionesData()) {
    const ed = JSON.parse(fs.readFileSync(path.join(dir, `${fecha}.json`), "utf8"));
    for (const l of ed.lecturas || []) claves.add(`${ed.date}|${l.title}`);
  }
  return claves;
}

function edicionesData() {
  const dir = path.join(aqui, "../data");
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort()
    .reverse();
}

// "2026-10-23" -> "2026/10/23/"
function rutaEdicion(fecha) {
  return `${fecha.replaceAll("-", "/")}/`;
}

// Tope de resultados que pinta site/js/buscar.js (results.slice(0, 80)).
const TOPE = 80;

// Mismo formato de fecha que pinta site/js/buscar.js, para casar cada resultado
// visible con su documento del índice aunque el título se repita en varias fechas.
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaWeb(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return `${d} ${MESES_CORTOS[m - 1]} ${y}`;
}

// Aciertos de una consulta de un solo token, calculados desde el índice con el
// mismo tokenizador que usa el buscador, sin llamar a searchDocs: así el test no
// hereda el fallo que vigila.
function documentosCon(indice, termino) {
  return indice.filter((doc) =>
    [doc.title, doc.summary, doc.source].some((campo) => tokenize(campo).includes(termino)));
}

// Token del índice que aparece en más documentos (título o resumen), que es el
// que puede superar el tope de resultados.
function tokenFrecuente(indice) {
  const cuenta = new Map();
  for (const doc of indice) {
    for (const t of new Set(tokenize(`${doc.title} ${doc.summary}`))) {
      cuenta.set(t, (cuenta.get(t) || 0) + 1);
    }
  }
  let mejor = null;
  for (const [t, n] of cuenta) {
    if (!mejor || n > mejor[1]) mejor = [t, n];
  }
  assert.ok(mejor, "no hay tokens en search-index.json");
  return mejor[0];
}

// Comprueba los resultados pintados contra el índice: el enlace debe ser la ruta
// que anuncia el documento (la edición o su página de lecturas) con el título,
// la fuente y la fecha que se ven, y ese documento debe contener el término en
// su título o resumen. No usa searchDocs: un buscador que ignore la consulta no
// puede satisfacer ambas cosas.
async function comprobarResultados(pagina, indice, termino, total, pintados) {
  const items = await pagina.locator(".buscar-resultados__item").evaluateAll((lis) =>
    lis.map((li) => ({
      href: li.querySelector("a")?.getAttribute("href") ?? "",
      fecha: li.querySelector(".archivo__fecha")?.textContent.trim() ?? "",
      titulo: li.querySelector(".archivo__lead")?.textContent.trim() ?? "",
      fuente: li.querySelector(".archivo__count")?.textContent.trim() ?? "",
    })));
  assert.equal(items.length, pintados,
    `se pintaron ${items.length} de ${total} aciertos, se esperaban ${pintados}`);
  for (const item of items) {
    const doc = indice.find((d) =>
      d.title === item.titulo && d.source === item.fuente && fechaWeb(d.date) === item.fecha);
    assert.ok(doc, `resultado sin documento en el índice: ${item.titulo} (${item.fecha}, ${item.fuente})`);
    assert.ok(tokenize(doc.title).includes(termino) || tokenize(doc.summary).includes(termino),
      `"${termino}" no aparece en el título ni el resumen de "${doc.title}"`);
    // El destino se deriva de data/ (si ese día publicó esta lectura) y de la
    // fecha, no de doc.path, del que buscar.js construye el href: las noticias
    // llevan a la edición del día y las lecturas a su página de esa fecha.
    const destino = lecturasPublicadas().has(`${doc.date}|${doc.title}`)
      ? `lecturas/${rutaEdicion(doc.date)}`
      : rutaEdicion(doc.date);
    const esperado = `${PREFIJO}${destino}`;
    assert.equal(item.href, esperado,
      `"${doc.title}" (${doc.date}) enlaza con ${item.href}; se esperaba ${esperado}`);
    assert.ok(fs.existsSync(path.join(RAIZ, item.href.slice(PREFIJO.length), "index.html")),
      `resultado que apunta a una página inexistente: ${item.href}`);
  }
}

// Edición más reciente del build, indexada igual que la portada (por rank).
function edicionReciente() {
  const fichero = `${edicionesData()[0]}.json`;
  const datos = JSON.parse(fs.readFileSync(path.join(aqui, "../data", fichero), "utf8"));
  datos.items = datos.items.slice().sort((a, b) => a.rank - b.rank);
  return datos;
}

test("portada: título, noticias y sin errores", async () => {
  const { contexto, pagina, problemas } = await abrir("");
  const titulo = await pagina.title();
  assert.ok(titulo.includes(site.title), `el título "${titulo}" no contiene "${site.title}"`);
  assert.ok((await pagina.locator("article.story").count()) >= 6, "menos de 6 article.story");
  assert.deepEqual(problemas, []);
  await contexto.close();
});

test("navegación de secciones", async () => {
  // Lecturas incluida aunque data/ no traiga ninguna: la sección siempre existe,
  // con su lista o con el vacío.
  for (const seccion of ["repositorios", "lecturas", "semana", "archivo"]) {
    const { contexto, pagina, problemas } = await abrir("");
    const [resp] = await Promise.all([
      pagina.waitForNavigation(),
      pagina.locator(`.masthead__nav a[href$="/${seccion}/"]`).first().click(),
    ]);
    assert.equal(resp.status(), 200);
    assert.ok(resp.url().endsWith(`${PREFIJO}${seccion}/`), `URL inesperada ${resp.url()}`);
    await pagina.waitForLoadState("load");
    assert.deepEqual(problemas, [], `errores en ${seccion}`);
    assert.ok((await pagina.locator("main").innerText()).trim().length > 50, `${seccion} sin contenido`);
    await contexto.close();
  }
});

test("menú móvil: cabe a 375 px con seis secciones y la activa se ve", async () => {
  // Editorial existirá entre Semana y Archivo cuando haya notas: se inyecta
  // para medir el caso de siete enlaces sin depender de que data/ las traiga.
  for (const [ruta, activa] of [["", "Noticias"], ["archivo/", "Archivo"]]) {
    const { contexto, pagina, problemas } = await abrir(ruta, {
      viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const medida = await pagina.evaluate((prefijo) => {
      const nav = document.querySelector(".masthead__nav");
      const editorial = document.createElement("a");
      editorial.href = `${prefijo}editorial/`;
      editorial.textContent = "Editorial";
      const archivo = [...nav.querySelectorAll("a")].find((a) => a.textContent.trim() === "Archivo");
      nav.insertBefore(editorial, archivo);
      const caja = nav.getBoundingClientRect();
      const enlaceActivo = nav.querySelector("a.is-active");
      const cajaActiva = enlaceActivo?.getBoundingClientRect();
      return {
        scrollWidth: nav.scrollWidth,
        clientWidth: nav.clientWidth,
        activa: enlaceActivo?.textContent.trim() ?? "",
        activaVisible: !!cajaActiva
          && cajaActiva.width > 0
          && cajaActiva.left >= caja.left - 0.5
          && cajaActiva.right <= caja.right + 0.5
          && cajaActiva.top >= caja.top - 0.5
          && cajaActiva.bottom <= caja.bottom + 0.5,
        enlaces: nav.querySelectorAll("a").length,
      };
    }, PREFIJO);
    assert.equal(medida.enlaces, 7, `${ruta || "portada"}: el menú no quedó con siete enlaces`);
    assert.equal(medida.activa, activa, `${ruta || "portada"}: la pestaña activa es "${medida.activa}"`);
    assert.ok(medida.scrollWidth <= medida.clientWidth,
      `${ruta || "portada"}: el menú mide ${medida.scrollWidth} px y su hueco ${medida.clientWidth} px`);
    assert.ok(medida.activaVisible, `${ruta || "portada"}: la pestaña activa no se ve entera`);
    assert.deepEqual(problemas, []);
    await contexto.close();
  }
});

test("página de edición: titular del rank 1 y navegación temporal", async () => {
  const edicion = edicionReciente();
  const fechas = edicionesData();
  assert.ok(fechas.length >= 2, "hacen falta al menos dos ediciones para validar la navegación");
  const ruta = rutaEdicion(edicion.date);
  const { contexto, pagina, problemas, resp } = await abrir(ruta);
  assert.equal(resp.status(), 200);
  const titular = (await pagina.locator(".lead__title").innerText()).trim();
  assert.ok(titular.includes(edicion.items[0].title), `el lead "${titular}" no es el rank 1`);
  const nav = pagina.locator('nav.edicion-nav[aria-label="Navegación entre días"]');
  await nav.waitFor();
  const flechas = await nav.locator("a.edicion-nav__flecha").evaluateAll((as) =>
    as.map((a) => ({ texto: a.textContent.trim(), href: a.getAttribute("href") })));
  // En la edición más reciente solo hay flecha «Anterior» y debe apuntar a la
  // edición inmediatamente anterior en data/, no a cualquier edición existente.
  // Se mira el texto de la flecha: si olderPath y newerPath se intercambian, el
  // enlace sigue apuntando al día correcto pero con la flecha «Siguiente».
  const anterior = `${PREFIJO}${rutaEdicion(fechas[1])}`;
  assert.equal(flechas.length, 1,
    `la edición más reciente debería tener una sola flecha y tiene ${flechas.length}`);
  assert.match(flechas[0].texto, /anterior/i, `la flecha dice "${flechas[0].texto}"`);
  assert.doesNotMatch(flechas[0].texto, /siguiente/i, `la flecha dice "${flechas[0].texto}"`);
  assert.equal(flechas[0].href, anterior,
    `la flecha «Anterior» debería enlazar con ${anterior} y enlaza con ${flechas[0].href}`);
  assert.deepEqual(problemas, []);
  await contexto.close();
});

test("buscar: resultados para un titular real", async () => {
  const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "search-index.json"), "utf8"));
  assert.ok(indice.length > 0, "search-index.json vacío");
  // Mismo tokenizador que usa el buscador: un titular con guiones o puntos se
  // parte igual en el índice y en la consulta.
  const termino = tokenize(indice[0].title).sort((a, b) => b.length - a.length)[0];
  assert.ok(termino, "no hay término útil en el primer titular");
  // Los aciertos se cuentan desde el índice, no con searchDocs: si la búsqueda
  // ignora la consulta, la expectativa no se rompe con ella.
  const aciertos = documentosCon(indice, termino);
  assert.ok(aciertos.length > 0, `el índice no encuentra "${termino}"`);
  // El estado cuenta todos los aciertos; la lista pinta como mucho TOPE.
  const texto = aciertos.length === 1 ? "1 resultado." : `${aciertos.length} resultados.`;
  const pintados = Math.min(aciertos.length, TOPE);
  let esperaIndice;
  const { contexto, pagina, problemas } = await abrir("archivo/buscar/", {}, (p) => {
    esperaIndice = p.waitForResponse((r) => r.url().includes("search-index.json") && r.ok());
  });
  // El listener de `input` se registra al terminar de cargar el índice: hay que
  // esperar a esa respuesta o el primer evento se pierde.
  await esperaIndice;
  await pagina.locator("#q").fill(termino);
  await pagina.locator(".buscar-resultados__item").first().waitFor();
  assert.equal((await pagina.locator("#buscar-estado").innerText()).trim(), texto);
  await comprobarResultados(pagina, indice, termino, aciertos.length, pintados);

  // Segunda consulta con el token que aparece en más documentos: supera el tope
  // y ejercita de verdad la rama results.slice(0, TOPE) de buscar.js.
  const frecuente = tokenFrecuente(indice);
  const totalFrecuente = documentosCon(indice, frecuente).length;
  assert.ok(totalFrecuente > TOPE,
    `el token más frecuente "${frecuente}" solo tiene ${totalFrecuente} aciertos y no supera el tope ${TOPE}`);
  const textoFrecuente = `${totalFrecuente} resultados.`;
  const itemsAntes = await pagina.locator(".buscar-resultados__item").count();
  await pagina.locator("#q").fill(frecuente);
  // Se espera a que la interfaz refleje la consulta nueva sin dormir un tiempo
  // fijo: cambia el estado o el número de resultados pintados.
  await pagina.waitForFunction(([estadoPrevio, itemsPrevios]) => {
    const estado = document.querySelector("#buscar-estado")?.textContent.trim() ?? "";
    const items = document.querySelectorAll(".buscar-resultados__item").length;
    return estado !== estadoPrevio || items !== itemsPrevios;
  }, [texto, itemsAntes]);
  assert.equal((await pagina.locator("#buscar-estado").innerText()).trim(), textoFrecuente);
  await comprobarResultados(pagina, indice, frecuente, totalFrecuente, TOPE);
  assert.deepEqual(problemas, []);
  await contexto.close();
});

test("buscar: estado de error si el índice no carga", async () => {
  const { contexto, pagina, problemas } = await abrir("archivo/buscar/", {}, (p) =>
    p.route("**/search-index.json", (ruta) => ruta.abort()));
  const estado = pagina.locator("#buscar-estado");
  await estado.waitFor();
  assert.equal((await estado.innerText()).trim(), "No se pudo cargar el índice de búsqueda.");
  assert.equal(await pagina.locator(".buscar-resultados__item").count(), 0);
  // El único fallo esperado es el índice que hemos bloqueado. El error de
  // consola de Chromium lleva la URL del recurso en su ubicación, así que se
  // descarta solo lo que nombre esa URL y no cualquier recurso caído.
  assert.ok(problemas.some((p) => p.includes("search-index.json")), "la petición del índice no se bloqueó");
  const inesperados = problemas.filter((p) => !p.includes("search-index.json"));
  assert.deepEqual(inesperados, []);
  await contexto.close();
});

test("feeds: XML válido y URLs absolutas con el pathPrefix", async () => {
  // site.url debe coincidir con el origen más el pathPrefix de Eleventy: si
  // pierde el prefijo, los XML apuntan fuera del sitio aunque BASE no cambie.
  assert.equal(site.url.replace(/\/$/, ""), BASE.replace(/\/$/, ""),
    "site.url no coincide con el origen más el pathPrefix de Eleventy");
  const { contexto, pagina, problemas } = await abrir("");
  const xml = await pagina.evaluate(async (rutas) => {
    const salida = {};
    for (const ruta of rutas) {
      const texto = await (await fetch(ruta)).text();
      const doc = new DOMParser().parseFromString(texto, "application/xml");
      const error = doc.querySelector("parsererror");
      const urls = [];
      for (const el of doc.getElementsByTagName("*")) {
        const nombre = el.localName;
        if (!["loc", "link", "guid", "id"].includes(nombre)) continue;
        const valor = (nombre === "link" ? el.getAttribute("href") || el.textContent : el.textContent).trim();
        if (valor) urls.push(valor);
      }
      salida[ruta] = { error: error?.textContent ?? null, raiz: doc.documentElement.localName, urls };
    }
    return salida;
  }, ["feed.xml", "atom.xml", "sitemap.xml"]);
  for (const [ruta, raiz] of [["feed.xml", "rss"], ["atom.xml", "feed"], ["sitemap.xml", "urlset"]]) {
    const { error, raiz: real, urls } = xml[ruta];
    assert.equal(error, null, `${ruta} no parsea como XML: ${error}`);
    assert.equal(real, raiz, `${ruta} tiene raíz <${real}>`);
    assert.ok(urls.length > 0, `${ruta} no declara ninguna URL`);
    const fuera = urls.filter((u) => !u.startsWith(BASE));
    assert.deepEqual(fuera, [], `${ruta}: URLs fuera de ${BASE}`);
  }
  // No basta con que haya alguna URL: feed y atom deben listar la edición más
  // reciente y el sitemap todas las ediciones de data/.
  const fechas = edicionesData();
  assert.ok(fechas.length > 0, "no hay ediciones en data/");
  const urlDe = (fecha) => `${BASE}${rutaEdicion(fecha)}`;
  for (const nombre of ["feed.xml", "atom.xml"]) {
    assert.ok(xml[nombre].urls.includes(urlDe(fechas[0])),
      `${nombre} no incluye la edición más reciente ${urlDe(fechas[0])}`);
  }
  const faltan = fechas.map(urlDe).filter((u) => !xml["sitemap.xml"].urls.includes(u));
  assert.deepEqual(faltan, [], "sitemap.xml no incluye todas las ediciones de data/");
  assert.deepEqual(problemas, []);
  await contexto.close();
});

test("paleta de búsqueda devuelve resultados", async () => {
  const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "search-index.json"), "utf8"));
  const termino = tokenize(indice[0].title).sort((a, b) => b.length - a.length)[0];
  assert.ok(termino, "no hay término útil en el primer titular");
  const { contexto, pagina, problemas } = await abrir("");
  await pagina.keyboard.press("Control+k");
  await pagina.locator("dialog.paleta[open]").waitFor();
  await pagina.locator(".paleta__input").fill(termino);
  await pagina.locator('.paleta__lista [role="option"]').first().waitFor();
  assert.ok((await pagina.locator('.paleta__lista [role="option"]').count()) >= 1);
  assert.deepEqual(problemas, []);
  await contexto.close();
});

test("el interruptor de tema cambia data-theme", async () => {
  const { contexto, pagina } = await abrir("");
  const antes = await pagina.evaluate(() => document.documentElement.dataset.theme || "");
  await pagina.locator(".tema").click();
  const despues = await pagina.evaluate(() => document.documentElement.dataset.theme);
  assert.ok(["light", "dark"].includes(despues));
  assert.notEqual(despues, antes);
  await contexto.close();
});

test("copiar el texto social de X deja en el portapapeles el de la primera tarjeta con X", async () => {
  // Se lee de la edición más reciente (la que publica la portada) en vez de copiarlo literal.
  // La web ordena por rank y solo pinta el botón de X donde hay texto para X (los posts son
  // best effort): la primera tarjeta con X es la de menor rank que lo tiene, no items[0].
  const ultima = fs.readdirSync(path.join(aqui, "../data")).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
  const items = JSON.parse(fs.readFileSync(path.join(aqui, "../data", ultima), "utf8")).items;
  const esperado = items.slice().sort((a, b) => a.rank - b.rank).find((it) => hasShareText(it.social?.x))?.social.x;
  assert.ok(esperado, "ninguna noticia de la portada tiene texto de X");
  const { contexto, pagina, problemas } = await abrir("", { permissions: ["clipboard-read", "clipboard-write"] });
  const tarjeta = pagina.locator(".share").filter({ has: pagina.locator('.share__copy[data-red="X"]') }).first();
  await tarjeta.locator("summary").click();
  await tarjeta.locator('.share__copy[data-red="X"]').click();
  await pagina.locator(".share__copy.is-copied").waitFor({ state: "attached" }); // el menú se cierra al copiar
  assert.equal(await pagina.evaluate(() => navigator.clipboard.readText()), esperado);
  assert.deepEqual(problemas, []);
  await contexto.close();
});

// Eficiencia en móvil emulado. Los presupuestos viven en presupuesto.json.
const presupuesto = JSON.parse(fs.readFileSync(path.join(aqui, "presupuesto.json"), "utf8"));
const medidas = {};

for (const [nombre, ruta] of [["portada", ""], ["repositorios", "repositorios/"], ["lecturas", "lecturas/"]]) {
  test(`eficiencia (móvil): ${nombre}`, async () => {
    trafico.bytes = 0; trafico.peticiones = 0;
    const contexto = await navegador.newContext({
      viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await contexto.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
    });
    const pagina = await contexto.newPage();
    await pagina.goto(`${origen}${PREFIJO}${ruta}`, { waitUntil: "load" });
    await pagina.waitForTimeout(500); // deja asentar LCP y peticiones diferidas
    const m = await pagina.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        nodos: document.getElementsByTagName("*").length,
        fcpMs: Math.round(fcp?.startTime ?? 0),
        lcpMs: Math.round(window.__lcp),
        loadMs: Math.round(nav.loadEventEnd),
      };
    });
    m.bytes = trafico.bytes;
    m.peticiones = trafico.peticiones;
    medidas[nombre] = m;
    await contexto.close();
    const tope = presupuesto[nombre];
    for (const k of Object.keys(tope)) {
      assert.ok(m[k] <= tope[k], `${nombre}.${k}: ${m[k]} supera el presupuesto ${tope[k]}`);
    }
  });
}

// Solo se escribe cuando están todas las medidas, para no dejar datos parciales.
after(() => {
  if (Object.keys(medidas).length < Object.keys(presupuesto).length) return;
  const salida = JSON.stringify(medidas, null, 2);
  fs.writeFileSync(path.join(aqui, ".metricas.json"), salida + "\n");
  console.log(`Métricas:\n${salida}`);
});
