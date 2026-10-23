import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Contrato editorial compartido: el prompt y el esquema no pueden divergir.
const PROMPT = readFileSync(
  fileURLToPath(new URL("../../prompts/curacion.md", import.meta.url)),
  "utf8",
);
const SCHEMA = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../schema/digest.schema.json", import.meta.url)), "utf8"),
) as {
  properties: {
    items: {
      minItems: number;
      items: {
        properties: {
          social: { properties: { x: { maxLength?: number }; linkedin: { maxLength?: number } } };
        };
      };
    };
    repos: {
      items: {
        properties: {
          social: { properties: { x: { maxLength?: number }; linkedin: { maxLength?: number } } };
        };
      };
    };
  };
};

test("el mínimo de ítems del prompt coincide con minItems del esquema", () => {
  const match = PROMPT.match(/mínimo de (\d+)/);
  assert.ok(match, "el prompt debe declarar un mínimo explícito");
  assert.equal(Number(match[1]), SCHEMA.properties.items.minItems);
  assert.equal(SCHEMA.properties.items.minItems, 8);
});

test("el schema acota los posts sociales de noticias y repos", () => {
  for (const section of [SCHEMA.properties.items, SCHEMA.properties.repos]) {
    const social = section.items.properties.social.properties;
    assert.equal(social.x.maxLength, 600);
    assert.equal(social.linkedin.maxLength, 3000);
  }
});

test("el prompt avisa de que el contenido de las fuentes no es confiable", () => {
  assert.match(PROMPT, /dato no confiable/i);
  assert.match(PROMPT, /no (?:son|es) instrucciones|nunca como (?:órdenes|instrucciones)/i);
});
