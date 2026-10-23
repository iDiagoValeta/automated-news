import { test } from "node:test";
import assert from "node:assert/strict";
import { deepseekProvider } from "../curate/deepseek.ts";
import { ProviderError } from "../ports.ts";

const originalKey = process.env.DEEPSEEK_API_KEY;

async function expectProviderError(
  run: () => Promise<unknown>,
  retryable: boolean,
  status?: number,
): Promise<void> {
  await assert.rejects(run, (e: unknown) => {
    assert.ok(e instanceof ProviderError, `se esperaba ProviderError, llegó ${String(e)}`);
    assert.equal(e.retryable, retryable);
    assert.equal(e.status, status);
    return true;
  });
}

function stubFetch(t: { after: (fn: () => void) => void }, impl: typeof fetch): void {
  const original = globalThis.fetch;
  // Cada test deja la credencial puesta: deepseekProvider la lee al construirse.
  process.env.DEEPSEEK_API_KEY = "test-key";
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  });
}

const response = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "Content-Type": "application/json" } });

test("un 401 es permanente: no se reintenta", async (t) => {
  stubFetch(t, async () => response(401, '{"error":"invalid key"}'));
  await expectProviderError(() => deepseekProvider().generate("s", "u"), false, 401);
});

test("un 429 es transitorio: se reintenta", async (t) => {
  stubFetch(t, async () => response(429, '{"error":"rate limit"}'));
  await expectProviderError(() => deepseekProvider().generate("s", "u"), true, 429);
});

test("un 5xx es transitorio: se reintenta", async (t) => {
  stubFetch(t, async () => response(503, "unavailable"));
  await expectProviderError(() => deepseekProvider().generate("s", "u"), true, 503);
});

test("un fallo de red es transitorio y no tiene status", async (t) => {
  stubFetch(t, async () => {
    throw new TypeError("fetch failed");
  });
  await expectProviderError(() => deepseekProvider().generate("s", "u"), true);
});

test("una respuesta sin contenido es transitoria", async (t) => {
  stubFetch(t, async () => response(200, '{"choices":[{"message":{}}]}'));
  await expectProviderError(() => deepseekProvider().generate("s", "u"), true);
});
