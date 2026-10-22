import type { ProviderName } from "./types.ts";

/** Puerto de salida: cualquier LLM capaz de completar un prompt de sistema + usuario. */
export interface Provider {
  name: ProviderName;
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}
