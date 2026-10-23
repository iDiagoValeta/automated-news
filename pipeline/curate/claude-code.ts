import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { Provider } from "../ports.ts";

const SCHEMA_PATH = fileURLToPath(new URL("../../schema/digest.schema.json", import.meta.url));

/**
 * Proveedor de fallback: invoca el CLI de Claude Code en modo headless (coste
 * cero vía suscripción Pro/Max). Requiere el secret CLAUDE_CODE_OAUTH_TOKEN.
 *
 * NOTA: no probado end-to-end en el desarrollo inicial (no había token local).
 * Si los flags del CLI cambian, ajustar aquí. La ruta principal es DeepSeek.
 */
export function claudeCodeProvider(): Provider {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error("Falta la variable de entorno CLAUDE_CODE_OAUTH_TOKEN");
  }
  const schemaJson = readFileSync(SCHEMA_PATH, "utf8");

  return {
    name: "claude-code",
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const prompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
      const raw = await runClaude(prompt, schemaJson);
      // El envoltorio de --output-format json trae la salida útil en
      // structured_output (o en result como texto).
      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        return raw; // por si el CLI devolviera el JSON del digest directamente
      }
      const env = envelope as { structured_output?: unknown; result?: unknown };
      if (env.structured_output !== undefined) return JSON.stringify(env.structured_output);
      if (typeof env.result === "string") return env.result;
      return JSON.stringify(envelope);
    },
  };
}

const CLAUDE_TIMEOUT_MS = 300_000;

export interface RunClaudeOptions {
  /** Binario a ejecutar; por defecto, el CLI `claude` del PATH. */
  bin?: string;
  /** Argumentos; por defecto, los flags headless del CLI. */
  args?: string[];
  /** Tiempo máximo antes de matar al hijo. Parametrizable para los tests. */
  timeoutMs?: number;
}

export function runClaude(prompt: string, schemaJson: string, options: RunClaudeOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  const bin = options.bin ?? (process.platform === "win32" ? "claude.cmd" : "claude");
  const args = options.args ?? ["-p", "--output-format", "json", "--json-schema", schemaJson];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    // El CLI puede quedarse esperando auth, red o una actualización: sin este
    // timer la curación no terminaría nunca (issue #45).
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI expiró tras ${timeoutMs} ms y se mató el proceso`));
    }, timeoutMs);
    const settle = (action: () => void) => {
      clearTimeout(timer);
      action();
    };
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => settle(() => reject(e)));
    child.on("close", (code) => {
      settle(() => {
        if (code === 0) resolve(out);
        else reject(new Error(`claude CLI salió con código ${code}: ${err.slice(0, 500)}`));
      });
    });
    // Si el hijo muere (timeout, flags inválidos) antes de leer todo el prompt,
    // la escritura da EPIPE; sin listener, Node lo lanza como excepción no
    // capturada y tumba el pipeline entero en vez de rechazar esta promesa.
    child.stdin.on("error", () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
