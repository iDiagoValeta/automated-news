import type { ProviderName } from "./types.ts";

/** Puerto de salida: cualquier LLM capaz de completar un prompt de sistema + usuario. */
export interface Provider {
  name: ProviderName;
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}

/**
 * Error de un proveedor con la información que necesita el bucle de reintentos:
 * si merece la pena repetir la llamada y, cuando existe, el código HTTP. Se
 * marca explícitamente porque un 401 no se arregla reintentando y un 429 sí.
 */
export class ProviderError extends Error {
  status?: number;
  retryable: boolean;

  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.status = status;
  }
}
