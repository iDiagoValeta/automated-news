import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBold, assembleLinkedIn, assembleX, boldSans } from "../curate/social.ts";

const cp = (s: string) => [...s].length;
const URL = "https://ejemplo.com/articulo-de-prueba";
// Peso que X asigna: la URL cuenta como 23 con independencia de su longitud.
const xWeight = (post: string) => cp(post) - cp(URL) + 23;

test("boldSans convierte ASCII y respeta acentos y espacios", () => {
  const b = boldSans("Hola 5");
  assert.notEqual(b, "Hola 5");
  assert.equal(cp(b), cp("Hola 5"), "mapeo 1 a 1 por punto de código");
  assert.equal(boldSans("ñá"), "ñá", "los acentos se dejan igual");
});

test("applyBold convierte solo lo marcado con ** y descarta los asteriscos", () => {
  const out = applyBold("Texto con una **idea clave** dentro.");
  assert.ok(out.includes(boldSans("idea clave")));
  assert.ok(!out.includes("**"), "no deja asteriscos");
  assert.ok(out.includes("Texto con una "), "el resto queda en texto plano");
});

test("assembleX cabe en 280 con gancho corto y contiene todo", () => {
  const post = assembleX("Un gancho breve y directo que frena el scroll.", ["#OpenSource"], URL);
  assert.ok(post.includes("Un gancho breve y directo"));
  assert.ok(post.includes("#OpenSource"));
  assert.ok(post.endsWith(URL));
  assert.ok(xWeight(post) <= 280, `peso ${xWeight(post)} debe ser <= 280`);
});

test("assembleX suelta los hashtags antes de recortar el gancho", () => {
  // Gancho que solo cabe si se sueltan los hashtags.
  const hook = "x".repeat(250);
  const post = assembleX(hook, ["#UnHashtagLargoDeVerdad"], URL);
  assert.ok(xWeight(post) <= 280, `peso ${xWeight(post)}`);
  assert.ok(!post.includes("#UnHashtagLargoDeVerdad"), "sacrifica el hashtag, no el gancho");
});

test("assembleX recorta el gancho largo para no pasar de 280", () => {
  const post = assembleX("palabra ".repeat(80), [], URL);
  assert.ok(xWeight(post) <= 280, `peso ${xWeight(post)}`);
  assert.ok(post.includes("…"), "marca el recorte");
  assert.ok(post.endsWith(URL));
});

test("assembleLinkedIn abre con el gancho, pone en negrita lo marcado y añade hashtags y URL", () => {
  const post = assembleLinkedIn("Gancho de apertura. Con una **idea clave**.", ["#Tech"], URL);
  assert.ok(post.startsWith("Gancho de apertura"), "el gancho va primero");
  assert.ok(post.includes(boldSans("idea clave")));
  assert.ok(!post.includes("**"), "no deja asteriscos");
  assert.ok(post.includes("#Tech"));
  assert.ok(post.endsWith(URL));
});

test("assembleX con URL de GitHub respeta el peso t.co de 23", () => {
  const gh = "https://github.com/opencut-app/OpenCut";
  const xWeightGh = (post: string) => cp(post) - cp(gh) + 23;
  const post = assembleX(
    "Crearon un CapCut gratis y sin marcas de agua. Ya suma decenas de miles de estrellas.",
    ["#OpenCut", "#OpenSource"],
    gh,
  );
  assert.ok(post.endsWith(gh));
  assert.ok(xWeightGh(post) <= 280, `peso ${xWeightGh(post)} debe ser <= 280`);
});
