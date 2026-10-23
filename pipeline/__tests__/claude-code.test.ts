import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaude } from "../curate/claude-code.ts";

// Proceso que se queda vivo sin hacer nada: reproduce el CLI colgado sin
// depender de que `claude` esté instalado en la máquina de test.
const HANG = "setTimeout(() => {}, 1e9)";

test("runClaude rechaza con un error de expiración cuando vence el timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    runClaude("prompt", "{}", {
      bin: process.execPath,
      args: ["-e", HANG],
      timeoutMs: 200,
    }),
    /expiró/,
  );
  assert.ok(Date.now() - started < 2000, "el timeout debe cortar mucho antes de 2 s");
});

test("runClaude mata al hijo: no llega a ejecutar su trabajo tras expirar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-timeout-"));
  const marker = join(dir, "sigo-vivo");
  const script =
    `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"), 400)`;

  await assert.rejects(
    runClaude("prompt", "{}", {
      bin: process.execPath,
      args: ["-e", script],
      timeoutMs: 100,
    }),
    /expiró/,
  );

  // Si el kill no hubiera llegado, el proceso escribiría el marcador a los 400 ms.
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(existsSync(marker), false, "el proceso hijo debía estar muerto");
});

test("runClaude resuelve con la salida estándar cuando el comando termina", async () => {
  const out = await runClaude("hola", "{}", {
    bin: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)"],
    timeoutMs: 2000,
  });
  assert.equal(out, "hola");
});

test("runClaude rechaza sin excepción no capturada si el hijo muere sin leer un prompt grande", async () => {
  // Más de lo que cabe en el buffer del pipe: la escritura choca con el hijo ya muerto (EPIPE).
  const prompt = "x".repeat(2_000_000);
  await assert.rejects(
    runClaude(prompt, "{}", { bin: process.execPath, args: ["-e", "process.exit(3)"], timeoutMs: 5000 }),
    /código 3/,
  );
});
