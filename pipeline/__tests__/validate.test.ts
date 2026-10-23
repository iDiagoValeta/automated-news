import { test } from "node:test";
import assert from "node:assert/strict";
import { dropInventedUrlItems, validateDigest } from "../validate.ts";
import type { Digest, DigestItem } from "../types.ts";

const INPUT_URLS = new Set(
  Array.from({ length: 10 }, (_, i) => `https://src.com/n${i + 1}`),
);

function digestItem(i: number, over: Partial<DigestItem> = {}): DigestItem {
  return {
    rank: i,
    category: "lanzamientos",
    title: `Titular ${i}`,
    summary: "Resumen de dos frases. Segunda frase.",
    why_it_matters: "Por qué importa.",
    url: `https://src.com/n${i}`,
    source: "Fuente",
    ...over,
  };
}

function digest(items: DigestItem[]): Digest {
  return {
    date: "2026-07-18",
    generated_at: "2026-07-18T05:00:00Z",
    provider: "deepseek",
    items,
  };
}

function eightItems(): DigestItem[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => digestItem(i));
}

test("digest válido pasa", () => {
  const d = digest(eightItems());
  const r = validateDigest(d, INPUT_URLS);
  assert.ok(r.ok, r.errors.join("; "));
});

test("menos de 8 ítems falla (schema)", () => {
  const d = digest([1, 2, 3, 4, 5, 6, 7].map((i) => digestItem(i)));
  const r = validateDigest(d, INPUT_URLS);
  assert.equal(r.ok, false);
});

test("categoría inválida falla (schema)", () => {
  const items = eightItems();
  items[0] = digestItem(1, { category: "opinión" as unknown as DigestItem["category"] });
  const r = validateDigest(digest(items), INPUT_URLS);
  assert.equal(r.ok, false);
});

test("URL inventada (no en la entrada) falla", () => {
  const items = eightItems();
  items[2] = digestItem(3, { url: "https://inventada.com/x" });
  const r = validateDigest(digest(items), INPUT_URLS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("inventada.com")));
});

test("dropInventedUrlItems descarta las URL inventadas y conserva el resto", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => digestItem(i));
  items[2] = digestItem(3, { url: "https://inventada.com/x" });
  const d = digest(items);
  const dropped = dropInventedUrlItems(d, INPUT_URLS);
  assert.equal(dropped, 1);
  assert.equal(d.items.length, 8);
  assert.ok(!d.items.some((it) => it.url === "https://inventada.com/x"));
  // Al quitar un ítem los ranks quedan contiguos: si no, cualquier descarte
  // convertiría el digest en inválido por el hueco.
  assert.deepEqual(
    d.items.map((it) => it.rank),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  const r = validateDigest(d, INPUT_URLS);
  assert.ok(r.ok, r.errors.join("; "));
});

test("dropInventedUrlItems conserva ítems sin url string (los juzga el schema)", () => {
  const items = eightItems();
  delete (items[0] as Partial<DigestItem>).url;
  const d = digest(items);
  const dropped = dropInventedUrlItems(d, INPUT_URLS);
  assert.equal(dropped, 0);
  assert.equal(d.items.length, 8);
});

test("ranks repetidos falla", () => {
  const items = eightItems();
  items[1] = digestItem(2, { rank: 1 });
  const r = validateDigest(digest(items), INPUT_URLS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("rank")));
});

test("ranks que no empiezan en 1 fallan aunque no se repitan", () => {
  // 8 ítems para no chocar con el mínimo del schema: 2..9 es el caso real de
  // un modelo que numera desde 2.
  const items = [2, 3, 4, 5, 6, 7, 8, 9].map((i) => digestItem(i));
  const r = validateDigest(digest(items), INPUT_URLS);
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.includes("rank") && e.includes("1..8")),
    `mensaje esperado con el rango 1..8, recibido: ${r.errors.join("; ")}`,
  );
});

test("ranks con un hueco fallan aunque empiecen en 1", () => {
  const items = [1, 2, 3, 5, 6, 7, 8, 9].map((i) => digestItem(i));
  const r = validateDigest(digest(items), INPUT_URLS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("rank")));
});

test("sin descartes, dropInventedUrlItems no renumera ni tapa ranks inválidos", () => {
  // El caso del issue #49: ranks 2..9 sin URL inventada. Si el descarte los
  // renumerara, la validación posterior nunca vería el fallo.
  const items = [2, 3, 4, 5, 6, 7, 8, 9].map((i) => digestItem(i));
  const d = digest(items);
  const dropped = dropInventedUrlItems(d, INPUT_URLS);
  assert.equal(dropped, 0);
  assert.deepEqual(
    d.items.map((it) => it.rank),
    [2, 3, 4, 5, 6, 7, 8, 9],
  );
  const r = validateDigest(d, INPUT_URLS);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("rank") && e.includes("1..8")));
});
