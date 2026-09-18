import { test } from "node:test";
import assert from "node:assert/strict";
import { curate, type Provider } from "../curate/index.ts";
import type { NewsItem, ProviderName } from "../types.ts";

const URLS = Array.from({ length: 8 }, (_, i) => `https://src.example/n${i + 1}`);

function items(): NewsItem[] {
  return URLS.map((url, i) => ({
    title: `Candidato ${i + 1}`,
    snippet: "Texto de entrada.",
    url,
    source: "Fuente",
    published_at: "2026-07-18T08:00:00.000Z",
  }));
}

function payload() {
  return {
    date: "2000-01-01",
    generated_at: "2000-01-01T00:00:00.000Z",
    provider: "claude-code",
    items: URLS.slice(0, 6).map((url, i) => ({
      rank: i + 1,
      category: "lanzamientos",
      title: `Titular ${i + 1}`,
      summary: "Resumen de dos frases. Segunda frase.",
      why_it_matters: "Por qué importa esta noticia.",
      url,
      source: "Fuente",
    })),
  };
}

function mockProvider(name: ProviderName, generate: Provider["generate"]): Provider {
  return { name, generate };
}

const meta = {
  date: "2026-07-18",
  generated_at: "2026-07-18T10:00:00.000Z",
  provider: "deepseek" as const,
};

test("un AbortError en el primer generate se reintenta y la edición sale", async () => {
  let calls = 0;
  const provider = mockProvider("deepseek", async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return JSON.stringify(payload());
  });

  const digest = await curate(items(), meta, undefined, [provider]);
  assert.equal(digest.items.length, 6);
  assert.equal(digest.provider, "deepseek");
  assert.equal(digest.date, "2026-07-18");
  assert.ok(calls >= 2, "el segundo intento debe ejecutarse");
});

test("un TypeError de red en el primer generate se reintenta y la edición sale", async () => {
  let calls = 0;
  const provider = mockProvider("deepseek", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("terminated");
    return JSON.stringify(payload());
  });

  const digest = await curate(items(), meta, undefined, [provider]);
  assert.equal(digest.items.length, 6);
  assert.ok(calls >= 2);
});

test("tres fallos de red con un solo proveedor abortan la curación", async () => {
  let calls = 0;
  const provider = mockProvider("deepseek", async () => {
    calls += 1;
    throw new TypeError("terminated");
  });

  await assert.rejects(
    () => curate(items(), meta, undefined, [provider]),
    /Curación falló/,
  );
  assert.equal(calls, 3, "los errores de red consumen los tres intentos");
});

test("si el principal agota intentos, el secundario cura y deja su provider", async () => {
  let primaryCalls = 0;
  const primary = mockProvider("deepseek", async () => {
    primaryCalls += 1;
    throw new TypeError("terminated");
  });
  const secondary = mockProvider("claude-code", async () => JSON.stringify(payload()));

  const digest = await curate(items(), meta, undefined, [primary, secondary]);
  assert.equal(primaryCalls, 3);
  assert.equal(digest.provider, "claude-code");
  assert.equal(digest.items.length, 6);
});

test("si ambos proveedores fallan, se lanza el error actual", async () => {
  const primary = mockProvider("deepseek", async () => {
    throw new TypeError("terminated");
  });
  const secondary = mockProvider("claude-code", async () => {
    throw new TypeError("terminated");
  });

  await assert.rejects(
    () => curate(items(), meta, undefined, [primary, secondary]),
    /deepseek, claude-code/,
  );
});
