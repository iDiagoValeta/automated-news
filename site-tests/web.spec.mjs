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
import { searchDocs, tokenize } from "../site/_11ty/search.js";
import configurarEleventy from "../eleventy.config.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(aqui, "../_site");
const PREFIJO = "/automated-news/";

// pathPrefix real del build: se saca de la configuración de Eleventy, no de
// site.url, para que un site.url sin prefijo no pase por bueno.
function pathPrefixEleventy() {
  const config = {
    addPassthroughCopy() {},
    addTransform() {},
    addFilter() {},
  };
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
  pagina.on("console", (m) => m.type() === "error" && problemas.push(`consola: ${m.text()}`));
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
  for (const seccion of ["repositorios", "semana", "archivo"]) {
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
  const enlaces = await nav.locator("a.edicion-nav__flecha").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href")));
  // En la edición más reciente solo hay flecha «Anterior» y debe apuntar a la
  // edición inmediatamente anterior en data/, no a cualquier edición existente.
  const anterior = `${PREFIJO}${rutaEdicion(fechas[1])}`;
  assert.deepEqual(enlaces, [anterior],
    `la navegación temporal debería enlazar solo con ${anterior}`);
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
  const esperados = searchDocs(indice, termino);
  assert.ok(esperados.length > 0, `el índice no encuentra "${termino}"`);
  // El estado cuenta todos los aciertos; la lista pinta como mucho 80.
  const texto = esperados.length === 1 ? "1 resultado." : `${esperados.length} resultados.`;
  const pintados = Math.min(esperados.length, 80);
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
  const items = await pagina.locator(".buscar-resultados__item").count();
  assert.equal(items, pintados, `se pintaron ${items} resultados y el estado anuncia ${esperados.length}`);
  const destinos = await pagina.locator(".buscar-resultados__item a").evaluateAll((as) =>
    as.map((a) => a.getAttribute("href")));
  assert.ok(destinos.length >= 1);
  for (const href of destinos) {
    assert.ok(href.startsWith(PREFIJO), `resultado fuera del pathPrefix: ${href}`);
    assert.ok(fs.existsSync(path.join(RAIZ, href.slice(PREFIJO.length), "index.html")),
      `resultado que apunta a una página inexistente: ${href}`);
  }
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
  // El único fallo esperado es el índice que hemos bloqueado. Chromium lo apunta
  // además como error de consola genérico, sin la URL; cualquier otra cosa falla.
  assert.ok(problemas.some((p) => p.includes("search-index.json")), "la petición del índice no se bloqueó");
  const inesperados = problemas.filter((p) =>
    !p.includes("search-index.json") && !p.startsWith("consola: Failed to load resource"));
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

for (const [nombre, ruta] of [["portada", ""], ["repositorios", "repositorios/"]]) {
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
  if (Object.keys(medidas).length < 2) return;
  const salida = JSON.stringify(medidas, null, 2);
  fs.writeFileSync(path.join(aqui, ".metricas.json"), salida + "\n");
  console.log(`Métricas:\n${salida}`);
});
