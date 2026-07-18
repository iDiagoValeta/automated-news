import type { Provider } from "./index.ts";

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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
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
            max_tokens: 8192,
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as ChatResponse;
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("DeepSeek devolvió una respuesta vacía");
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
