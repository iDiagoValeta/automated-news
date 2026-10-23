import { ProviderError } from "../ports.ts";
import type { Provider } from "../ports.ts";

const ENDPOINT = "https://api.deepseek.com/chat/completions";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Proveedor DeepSeek. Endpoint compatible con el formato de OpenAI (chat
 * completions) con JSON mode. Modelo configurable por DEEPSEEK_MODEL.
 */
export function deepseekProvider(): Provider {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Falta la variable de entorno DEEPSEEK_API_KEY");
  // `||` y no `??`: en el workflow la variable puede llegar como cadena vacía.
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  return {
    name: "deepseek",
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      // Timeout amplio: Flash también razona por defecto y puede tardar. No
      // recorta la respuesta, solo evita cuelgues indefinidos.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300_000);
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          // 429 y 5xx son transitorios; el resto de 4xx (400, 401, 404) no
          // mejora al repetir, así que el bucle debe pasar al siguiente proveedor.
          const retryable = res.status === 429 || res.status >= 500;
          throw new ProviderError(
            `DeepSeek HTTP ${res.status}: ${body.slice(0, 300)}`,
            retryable,
            res.status,
          );
        }
        const data = (await res.json()) as ChatResponse;
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new ProviderError("DeepSeek devolvió una respuesta vacía", true);
        return content;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        // fetch lanza TypeError en fallos de red y AbortError al vencer el
        // timeout: ambos son transitorios.
        throw new ProviderError(`DeepSeek: error de red o timeout: ${String(e)}`, true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
