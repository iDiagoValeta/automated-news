import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleLinkedIn, assembleX, boldSans } from "../curate/social.ts";

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

test("assembleX cabe en 280 con gancho corto y contiene todo", () => {
  const post = assembleX("Titular de prueba", "Un gancho breve y directo.", ["#OpenSource"], URL);
  assert.ok(post.includes("Titular de prueba"));
  assert.ok(post.includes("#OpenSource"));
  assert.ok(post.endsWith(URL));
  assert.ok(xWeight(post) <= 280, `peso ${xWeight(post)} debe ser <= 280`);
});

test("assembleX recorta el gancho largo para no pasar de 280", () => {
  const post = assembleX("T", "palabra ".repeat(80), [], URL);
  assert.ok(xWeight(post) <= 280, `peso ${xWeight(post)}`);
  assert.ok(post.includes("…"), "marca el recorte");
  assert.ok(post.endsWith(URL));
});

test("assembleLinkedIn lleva titular en negrita, hashtags y URL", () => {
  const post = assembleLinkedIn("Titular", "Texto para LinkedIn con contexto.", ["#Tech"], URL);
  assert.ok(post.includes(boldSans("Titular")));
  assert.ok(post.includes("#Tech"));
  assert.ok(post.includes(URL));
});
