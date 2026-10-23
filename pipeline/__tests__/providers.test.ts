import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProviderName } from "../providers.ts";

// Aísla la variable del entorno del proceso de test para no filtrar estado
// entre casos ni depender de la configuración de quien ejecute la suite.
function withProviderEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.LLM_PROVIDER;
  if (value === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previous;
  }
}

test("sin LLM_PROVIDER el proveedor por defecto es deepseek", () => {
  assert.equal(withProviderEnv(undefined, resolveProviderName), "deepseek");
});

test("LLM_PROVIDER vacío se interpreta como deepseek", () => {
  assert.equal(withProviderEnv("", resolveProviderName), "deepseek");
});

test("LLM_PROVIDER=deepseek y LLM_PROVIDER=claude-code se respetan", () => {
  assert.equal(withProviderEnv("deepseek", resolveProviderName), "deepseek");
  assert.equal(withProviderEnv("claude-code", resolveProviderName), "claude-code");
});

test("un valor desconocido de LLM_PROVIDER aborta nombrando la variable y los valores válidos", () => {
  assert.throws(
    () => withProviderEnv("deepsek", resolveProviderName),
    (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /LLM_PROVIDER/);
      assert.match(e.message, /deepseek/);
      assert.match(e.message, /claude-code/);
      return true;
    },
  );
});

test("un valor con espacio en vez de guion tampoco cae en deepseek en silencio", () => {
  assert.throws(() => withProviderEnv("claude code", resolveProviderName), /LLM_PROVIDER/);
});

test("un valor en blanco no se confunde con vacío: aborta en vez de adivinar", () => {
  assert.throws(() => withProviderEnv("   ", resolveProviderName), /LLM_PROVIDER/);
});
