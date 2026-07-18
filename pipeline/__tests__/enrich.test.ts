import { test } from "node:test";
import assert from "node:assert/strict";
import { extractReadable } from "../enrich.ts";

test("extractReadable toma og:description y párrafos largos", () => {
  const html = `
    <html><head>
      <meta property="og:description" content="Resumen del art&#237;culo desde og." />
    </head><body>
      <p>Corto.</p>
      <p>Este es un párrafo con longitud más que suficiente para superar el umbral mínimo y ser incluido.</p>
      <script>ignorar()</script>
    </body></html>`;
  const text = extractReadable(html);
  assert.ok(text.includes("Resumen del artículo desde og"), "decodifica entidades y usa og:description");
  assert.ok(text.includes("párrafo con longitud"), "incluye párrafos largos");
  assert.ok(!text.includes("Corto."), "descarta párrafos demasiado cortos");
  assert.ok(!text.includes("ignorar"), "no arrastra scripts");
});

test("extractReadable cae a meta description si no hay og", () => {
  const html = `<head><meta name="description" content="Descripción estándar."></head><body></body>`;
  assert.ok(extractReadable(html).includes("Descripción estándar"));
});
