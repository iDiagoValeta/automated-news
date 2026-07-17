import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { Provider } from "./index.ts";

const SCHEMA_PATH = fileURLToPath(new URL("../../schema/digest.schema.json", import.meta.url));

/**
 * Proveedor de fallback: invoca el CLI de Claude Code en modo headless (coste
 * cero vía suscripción Pro/Max). Requiere el secret CLAUDE_CODE_OAUTH_TOKEN.
 *
 * NOTA: no probado end-to-end en el desarrollo inicial (no había token local).
 * Se implementa según la invocación descrita en el SPEC §5b. Si los flags del
 * CLI cambian, ajustar aquí. La ruta principal es DeepSeek.
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

function runClaude(prompt: string, schemaJson: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === "win32" ? "claude.cmd" : "claude";
    const child = spawn(
      bin,
      ["-p", "--output-format", "json", "--json-schema", schemaJson],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI salió con código ${code}: ${err.slice(0, 500)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
