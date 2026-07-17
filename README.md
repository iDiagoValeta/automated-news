# La Terminal

Diario estático de noticias de tecnología en español. Cada mañana publica una edición con las 8 a 10 noticias más relevantes del día, resumidas y con enlace a la fuente original, más un archivo histórico navegable por fechas. Se genera con un workflow de GitHub Actions y se sirve en GitHub Pages. No hay servidores ni base de datos.

- Sitio: https://idiagovaleta.github.io/automated-news/
- Especificación original del proyecto: [SPEC.md](SPEC.md)

## Cómo funciona

Un único script orquestador ([`pipeline/index.ts`](pipeline/index.ts)) ejecuta cinco pasos:

1. **Recogida.** Lee las fuentes de [`config/sources.json`](config/sources.json) (RSS de blogs de laboratorios, medios tecnológicos y la API de Hacker News) y toma lo publicado en las últimas 24 horas. Si una fuente falla se registra y se continúa; solo aborta si fallan todas.
2. **Normalización.** Formato común `{ title, snippet, url, source, published_at }` y deduplicación por URL canónica.
3. **Curación.** Una llamada al proveedor de lenguaje configurado devuelve el digest del día en JSON, eligiendo y redactando en español. Nunca inventa URLs: elige entre las de entrada.
4. **Validación.** Ajv contra [`schema/digest.schema.json`](schema/digest.schema.json), más la comprobación de que cada URL existe en la entrada. Hasta dos reintentos inyectando el error; si sigue sin validar, no se publica.
5. **Renderizado y publicación.** El digest se guarda en `data/YYYY-MM-DD.json`, Eleventy construye el sitio y GitHub Pages lo sirve.

El modelo se usa como un paso más del script, con prompt fijo ([`prompts/curacion.md`](prompts/curacion.md)) y salida validada.

## Uso en local

Requiere Node.js 24 o superior (el pipeline es TypeScript ejecutado con el *type stripping* nativo de Node, sin paso de compilación).

```bash
git clone https://github.com/iDiagoValeta/automated-news.git
cd automated-news
npm install

npm run pipeline -- --collect-only   # imprime los ítems normalizados, sin llamar al modelo
npm test                             # normalización, validación y comprobación de URLs
npm run build                        # genera _site/
npm run dev                          # http://localhost:8080/automated-news/
```

Para generar una edición real en local hace falta una API key de DeepSeek:

```bash
export DEEPSEEK_API_KEY=sk-...   # PowerShell: $env:DEEPSEEK_API_KEY="sk-..."
npm run pipeline                 # escribe data/<hoy>.json
```

Sin credencial de proveedor el pipeline no falla: registra que no genera edición y termina con éxito, conservando la última publicada.

## Configuración

### Fuentes: [`config/sources.json`](config/sources.json)

Cada fuente se activa o desactiva con `enabled`. Campos globales: `window_hours` (ventana temporal en horas), `timeout_ms` y `user_agent`. La fuente de Anthropic es un mirror no oficial marcado como `fragile`: si falla, se ignora sin abortar.

### Variables de entorno

| Variable | Uso |
|---|---|
| `DEEPSEEK_API_KEY` | Credencial del proveedor principal (secret). |
| `DEEPSEEK_MODEL` | Modelo de DeepSeek. Por defecto `deepseek-chat`. |
| `LLM_PROVIDER` | `deepseek` (por defecto) o `claude-code`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Solo para el proveedor `claude-code`. |

### Despliegue

En `Settings, Pages` el origen es *GitHub Actions*. El secret `DEEPSEEK_API_KEY` se configura en `Settings, Secrets and variables, Actions`. El workflow [`daily.yml`](.github/workflows/daily.yml) corre por cron (04:17 UTC) y admite ejecución manual desde la pestaña Actions.

## Proveedor de fallback: `claude-code`

Alternativa a DeepSeek vía suscripción Pro o Max. El token se genera con `claude setup-token` y se guarda como secret `CLAUDE_CODE_OAUTH_TOKEN`; se activa con `LLM_PROVIDER=claude-code`. La implementación ([`pipeline/curate/claude-code.ts`](pipeline/curate/claude-code.ts)) sigue la invocación descrita en el SPEC y no está probada end to end.

## Dependencias

| Paquete | Para qué |
|---|---|
| `rss-parser` | Parser RSS y Atom. El XML se descarga con `fetch` propio (User-Agent y timeout) y solo se parsea con la librería. |
| `ajv` y `ajv-formats` | Validación del digest contra JSON Schema. |
| `@11ty/eleventy` (dev) | Generador estático con plantillas Nunjucks. |
| `typescript` y `@types/node` (dev) | Solo para `npm run typecheck`. |

HTTP y la ejecución de TypeScript usan capacidades nativas de Node, sin dependencias añadidas.

## Datos de ejemplo

Las ediciones del 14 al 16 de julio de 2026 están curadas a mano a partir de ítems reales y llevan `provider: "seed"` en su JSON. Sirven para que el sitio tenga contenido de partida.

## Notas de operación

- GitHub deshabilita los crons tras 60 días sin actividad en el repo. Si el sitio deja de actualizarse sin motivo aparente, lo primero es comprobar en Actions si el workflow sigue habilitado.
- Si en la ventana de 24 horas hay menos de seis ítems, no se publica edición y se conserva la última. `window_hours` en `config/sources.json` amplía la ventana. Los feeds de *tag* de TechCrunch suelen ir retrasados.
- Cuando el workflow falla en algún paso, abre un issue con enlace al run.
- Los triggers `schedule` de GitHub son best effort y pueden retrasarse; el diseño no depende de la hora exacta.
