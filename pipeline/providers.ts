import type { Provider } from "./ports.ts";
import type { ProviderName } from "./types.ts";
import { deepseekProvider } from "./curate/deepseek.ts";
import { claudeCodeProvider } from "./curate/claude-code.ts";

// Raíz de composición de los adaptadores LLM: único módulo que los conoce.

export function resolveProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  // Vacío o sin definir conserva el proveedor por defecto.
  if (raw === "") return "deepseek";
  if (raw === "deepseek" || raw === "claude-code") return raw;
  // Un typo no puede caer en deepseek en silencio: el pipeline publicaría una
  // edición con el proveedor equivocado o se saltaría por falta de credencial.
  throw new Error(
    `LLM_PROVIDER="${process.env.LLM_PROVIDER}" no es válido. ` +
      `Valores válidos: deepseek, claude-code.`,
  );
}

/** ¿Está presente la credencial del proveedor? Permite saltar sin fallar. */
export function providerCredentialPresent(name: ProviderName): boolean {
  if (name === "claude-code") return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function getProvider(name: ProviderName): Provider {
  return name === "claude-code" ? claudeCodeProvider() : deepseekProvider();
}

/** El otro proveedor del par deepseek / claude-code. */
export function alternateProviderName(name: ProviderName): ProviderName {
  return name === "deepseek" ? "claude-code" : "deepseek";
}

/**
 * Cadena de proveedores: el principal y, si hay credencial, el alternativo
 * para failover automático.
 */
export function resolveProviderChain(primary: ProviderName): Provider[] {
  const chain: Provider[] = [getProvider(primary)];
  const alt = alternateProviderName(primary);
  if (providerCredentialPresent(alt)) chain.push(getProvider(alt));
  return chain;
}
