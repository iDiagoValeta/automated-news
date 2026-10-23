import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkExistingDigest, writeFileAtomic } from "../index.ts";
import type { Digest, DigestItem } from "../types.ts";

function validDigest(): Digest {
  const items: DigestItem[] = Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    category: "lanzamientos",
    title: `Titular ${i + 1}`,
    summary: "Resumen de dos frases. Segunda frase.",
    why_it_matters: "Por qué importa.",
    url: `https://src.example/n${i + 1}`,
    source: "Fuente",
  }));
  return {
    date: "2026-10-24",
    generated_at: "2026-10-24T05:00:00.000Z",
    provider: "deepseek",
    items,
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "digest-index-"));
}

test("checkExistingDigest no reutiliza un fichero inexistente", () => {
  const status = checkExistingDigest(join(tempDir(), "2026-10-24.json"));
  assert.equal(status.exists, false);
  assert.equal(status.reusable, false);
});

test("checkExistingDigest rechaza un JSON truncado y permite regenerar", () => {
  const path = join(tempDir(), "2026-10-24.json");
  writeFileSync(path, '{"date":"2026-10-24","items":[');
  const status = checkExistingDigest(path);
  assert.equal(status.exists, true);
  assert.equal(status.reusable, false);
  assert.match(status.reason, /JSON/i);
});

test("checkExistingDigest rechaza un JSON completo sin ítems", () => {
  const path = join(tempDir(), "2026-10-24.json");
  writeFileSync(
    path,
    JSON.stringify({
      date: "2026-10-24",
      generated_at: "2026-10-24T05:00:00.000Z",
      provider: "deepseek",
      items: [],
    }),
  );
  const status = checkExistingDigest(path);
  assert.equal(status.reusable, false);
  assert.match(status.reason, /items/);
});

test("checkExistingDigest reutiliza una edición completa y válida", () => {
  const path = join(tempDir(), "2026-10-24.json");
  writeFileSync(path, JSON.stringify(validDigest()));
  const status = checkExistingDigest(path);
  assert.equal(status.exists, true);
  assert.equal(status.reusable, true);
  assert.equal(status.reason, "");
});

test("writeFileAtomic publica el contenido y no deja el temporal", () => {
  const path = join(tempDir(), "2026-10-24.json");
  writeFileAtomic(path, '{"ok":true}\n');
  assert.equal(readFileSync(path, "utf8"), '{"ok":true}\n');
  assert.equal(existsSync(`${path}.tmp`), false);
});

test("si la escritura del temporal falla, el fichero publicado no se toca", () => {
  const path = join(tempDir(), "2026-10-24.json");
  writeFileSync(path, "anterior\n");
  // Un directorio en la ruta del temporal hace fallar writeFileSync antes del rename.
  mkdirSync(`${path}.tmp`);

  assert.throws(() => writeFileAtomic(path, "nuevo\n"));
  assert.equal(readFileSync(path, "utf8"), "anterior\n");
});

test("checkExistingDigest reutiliza una edición publicada aunque la validación vigente sea más estricta", () => {
  // Ranks con hueco: válido cuando se publicó, inválido para validateDigest hoy.
  const digest = validDigest();
  digest.items[2].rank = 99;
  const path = join(tempDir(), "2026-10-24.json");
  writeFileSync(path, JSON.stringify(digest));
  assert.equal(checkExistingDigest(path).reusable, true);
});
