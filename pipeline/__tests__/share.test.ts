import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasShareText, intentLinkedIn, intentX, shareModel } from "../../site/_11ty/share.js";

const TPL = readFileSync(fileURLToPath(new URL("../../site/_includes/share.njk", import.meta.url)), "utf8");

test("hasShareText rechaza vacío, no string y solo espacios", () => {
  assert.equal(hasShareText("hola"), true);
  assert.equal(hasShareText("  x  "), true);
  assert.equal(hasShareText(""), false);
  assert.equal(hasShareText("   "), false);
  assert.equal(hasShareText(undefined), false);
  assert.equal(hasShareText(null), false);
  assert.equal(hasShareText(1), false);
});

test("intentX usa x.com/intent/post y no duplica la URL como parámetro", () => {
  const text = "Gancho breve.\n\n#IA\nhttps://ejemplo.com/a";
  const href = intentX(text);
  const parsed = new URL(href);
  assert.equal(parsed.origin + parsed.pathname, "https://x.com/intent/post");
  assert.equal(parsed.searchParams.get("text"), text);
  assert.equal(parsed.searchParams.get("url"), null);
});

test("intentX y intentLinkedIn no rompen con texto vacío", () => {
  assert.equal(intentX(""), "");
  assert.equal(intentX("   "), "");
  assert.equal(intentX(undefined), "");
  assert.equal(intentLinkedIn(""), "");
  assert.equal(intentLinkedIn(null), "");
});

test("intentX codifica saltos, ampersand y unicode", () => {
  const text = "A & B\nsegunda línea 𝕏";
  const href = intentX(text);
  assert.ok(href.includes("text="));
  assert.ok(!href.includes("A & B"), "el ampersand va percent-encoded");
  assert.equal(new URL(href).searchParams.get("text"), text);
});

test("intentLinkedIn usa el compositor del feed con texto precargado", () => {
  const text = "Gancho.\n\nhttps://ejemplo.com/a";
  const href = intentLinkedIn(text);
  const parsed = new URL(href);
  assert.equal(parsed.origin + parsed.pathname, "https://www.linkedin.com/feed/");
  assert.equal(parsed.searchParams.get("shareActive"), "true");
  assert.equal(parsed.searchParams.get("text"), text);
});

test("shareModel oculta redes sin texto y no lanza si social falta", () => {
  assert.deepEqual(shareModel(undefined), { x: null, linkedin: null });
  assert.deepEqual(shareModel({}), { x: null, linkedin: null });
  assert.deepEqual(shareModel({ x: "  ", linkedin: "" }), { x: null, linkedin: null });

  const onlyX = shareModel({ x: "post x", linkedin: "" });
  assert.ok(onlyX.x);
  assert.equal(onlyX.linkedin, null);
  assert.equal(onlyX.x.href, intentX("post x"));

  const onlyLi = shareModel({ linkedin: "post li" });
  assert.equal(onlyLi.x, null);
  assert.ok(onlyLi.linkedin);
  assert.equal(onlyLi.linkedin.href, intentLinkedIn("post li"));
});

test("shareModel de un digest real produce intents con el texto original", () => {
  const edition = JSON.parse(readFileSync(fileURLToPath(new URL("../../data/2026-09-18.json", import.meta.url)), "utf8"));
  const social = edition.items[0].social;
  const model = shareModel(social);
  assert.ok(model.x && model.linkedin);
  assert.equal(new URL(model.x.href).searchParams.get("text"), social.x);
  assert.equal(new URL(model.linkedin.href).searchParams.get("text"), social.linkedin);
  assert.match(model.x.href, /^https:\/\/x\.com\/intent\/post\?text=/);
  assert.match(model.linkedin.href, /^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/);
});

test("la plantilla share usa shareModel y no asume las dos redes", () => {
  assert.match(TPL, /social \| shareModel/);
  assert.match(TPL, /s\.x or s\.linkedin/);
  assert.match(TPL, /\{% if s\.x %\}/);
  assert.match(TPL, /\{% if s\.linkedin %\}/);
  assert.match(TPL, /Publicar en X/);
  assert.match(TPL, /Publicar en LinkedIn/);
  assert.match(TPL, /share__copy/);
  assert.match(TPL, /data-copy="\{\{ s\.x\.text \}\}"/);
  assert.match(TPL, /data-copy="\{\{ s\.linkedin\.text \}\}"/);
  assert.match(TPL, /target="_blank"/);
  assert.match(TPL, /rel="noopener noreferrer"/);
});
