import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchJson, fetchText } from "../http.ts";
import { searchApiFallback } from "../sources/github.ts";

// Servidor local que manda cabeceras 200 y deja el cuerpo abierto: reproduce
// un origen que gotea o se cuelga después de responder (issue #43).
async function stalledBodyServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"items":[');
    // A propósito no se llama a res.end().
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

// Con el código antiguo la promesa no rechaza nunca; este límite convierte
// ese cuelgue en un fallo visible en vez de bloquear la suite.
async function withDeadline<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`la llamada superó ${ms} ms sin abortar`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const TIMEOUT_MS = 250;

test("fetchText aborta si el cuerpo no termina dentro del timeout", async () => {
  const server = await stalledBodyServer();
  try {
    await assert.rejects(
      withDeadline(2000, fetchText(server.url, TIMEOUT_MS, "test-agent")),
      new RegExp(`Timeout de ${TIMEOUT_MS} ms`),
    );
  } finally {
    await server.close();
  }
});

test("fetchJson aborta si el cuerpo no termina dentro del timeout", async () => {
  const server = await stalledBodyServer();
  try {
    await assert.rejects(
      withDeadline(2000, fetchJson(server.url, TIMEOUT_MS, "test-agent")),
      new RegExp(`Timeout de ${TIMEOUT_MS} ms`),
    );
  } finally {
    await server.close();
  }
});

test("searchApiFallback aborta si el cuerpo de la API no termina", async () => {
  const server = await stalledBodyServer();
  // Redirige solo esta petición al servidor local: la API real no se toca.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    realFetch(server.url, init)) as typeof fetch;
  try {
    await assert.rejects(
      withDeadline(
        2000,
        searchApiFallback({ user_agent: "test-agent", timeout_ms: TIMEOUT_MS }, { limit: 5 }),
      ),
      new RegExp(`Timeout de ${TIMEOUT_MS} ms`),
    );
  } finally {
    globalThis.fetch = realFetch;
    await server.close();
  }
});
