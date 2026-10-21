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

const aqui = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(aqui, "../_site");
const PREFIJO = "/automated-news/";
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
async function abrir(ruta, opciones = {}) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, ...opciones });
  const pagina = await contexto.newPage();
  const problemas = [];
  pagina.on("console", (m) => m.type() === "error" && problemas.push(`consola: ${m.text()}`));
  pagina.on("pageerror", (e) => problemas.push(`excepción: ${e.message}`));
  pagina.on("requestfailed", (r) => problemas.push(`fallo: ${r.url()}`));
  pagina.on("response", (r) => {
    if (r.url().startsWith(origen) && r.status() >= 400) problemas.push(`${r.status()} ${r.url()}`);
  });
  const resp = await pagina.goto(`${origen}${PREFIJO}${ruta}`, { waitUntil: "load" });
  return { contexto, pagina, problemas, resp };
}

test("portada: título, noticias y sin errores", async () => {
  const { contexto, pagina, problemas } = await abrir("");
  const titulo = await pagina.title();
  assert.match(titulo, /La Terminal/i);
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

test("paleta de búsqueda devuelve resultados", async () => {
  const indice = JSON.parse(fs.readFileSync(path.join(RAIZ, "search-index.json"), "utf8"));
  const termino = indice[0].title.split(/\s+/).sort((a, b) => b.length - a.length)[0].replace(/[^\p{L}\p{N}]/gu, "");
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
