# Diario IA

Web estática que cada mañana amanece con una edición nueva: **8-10 noticias de IA de las últimas 24 horas**, curadas y resumidas **en español**, con enlace a la fuente original y un archivo histórico navegable por fechas. Todo vive en este repositorio y se ejecuta con **GitHub Actions** (cron diario) + **GitHub Pages**. Sin servidores ni base de datos.

- **Sitio en vivo:** https://idiagovaleta.github.io/automated-news/
- **Especificación completa:** [SPEC.md](SPEC.md)

## Cómo funciona

Pipeline determinista de 5 pasos (un único script orquestador, [`pipeline/index.ts`](pipeline/index.ts)):

1. **Recogida** — lee las fuentes de [`config/sources.json`](config/sources.json) (RSS de blogs oficiales, RSS de medios y la API de Hacker News) y se queda con lo publicado en las últimas 24 h. Tolerante a fallos: si una fuente cae, se registra y se continúa; solo aborta si fallan **todas**.
2. **Normalización** — formato común `{ title, snippet, url, source, published_at }` + deduplicación por URL canónica.
3. **Curación (LLM)** — una llamada al proveedor configurado devuelve el digest del día (JSON). El LLM **elige y redacta en español**, nunca inventa URLs.
4. **Validación** — Ajv contra [`schema/digest.schema.json`](schema/digest.schema.json) + comprobación de que cada URL existe en la entrada. Hasta 2 reintentos inyectando el error; si sigue fallando, no se publica nada.
5. **Renderizado + deploy** — el digest se guarda en `data/YYYY-MM-DD.json`, Eleventy construye el sitio y GitHub Pages lo publica.

El LLM se usa en **modo no agentico**: un paso más del script, con prompt fijo ([`prompts/curacion.md`](prompts/curacion.md)) y salida validada.

## Puesta en marcha (< 15 min)

### 1. Requisitos

- **Node.js ≥ 24** (el pipeline es TypeScript ejecutado con el *type stripping* nativo de Node; no hay paso de compilación).

### 2. Instalar y probar en local

```bash
git clone https://github.com/iDiagoValeta/automated-news.git
cd automated-news
npm install

# Fase de recogida: imprime por consola los ítems normalizados (no llama al LLM)
npm run pipeline -- --collect-only

# Tests (normalización de feeds con fixtures reales, validación, URLs del digest)
npm test

# Construir y previsualizar el sitio con los datos existentes
npm run build
npm run dev   # http://localhost:8080/automated-news/
```

### 3. Generar una edición real en local (opcional)

Necesitas una API key de DeepSeek:

```bash
export DEEPSEEK_API_KEY=sk-...        # PowerShell: $env:DEEPSEEK_API_KEY="sk-..."
npm run pipeline                      # escribe data/<hoy>.json
```

> Sin credencial de proveedor el pipeline **no falla**: registra que no genera edición nueva y termina con éxito, conservando la última publicada.

### 4. Configurar el despliegue automático

1. **Pages:** en `Settings → Pages`, *Build and deployment → Source = GitHub Actions*.
2. **Secret:** en `Settings → Secrets and variables → Actions`, añade `DEEPSEEK_API_KEY`.
3. (Opcional) **Variables:** `LLM_PROVIDER` (`deepseek` por defecto) y `DEEPSEEK_MODEL`.
4. Lanza el workflow **Edición diaria** a mano (`Actions → Edición diaria → Run workflow`) para el primer deploy, o espera al cron (04:17 UTC ≈ 06:17 CEST).

## Configuración

### Fuentes — [`config/sources.json`](config/sources.json)

Activa/desactiva fuentes con `enabled` sin tocar código. Campos globales: `window_hours` (ventana temporal, 24 por defecto), `timeout_ms`, `user_agent`. La fuente de Anthropic es un **mirror no oficial** marcado como `fragile: true`: si falla, se ignora sin abortar. Hugging Face *trending* viene desactivada.

### Variables de entorno

| Variable | Uso |
|---|---|
| `DEEPSEEK_API_KEY` | Credencial del proveedor principal (secret). |
| `DEEPSEEK_MODEL` | Modelo DeepSeek; por defecto `deepseek-chat`. |
| `LLM_PROVIDER` | `deepseek` (defecto) o `claude-code`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Solo si usas el fallback `claude-code`. |

### Fallback `claude-code`

Proveedor de coste cero vía suscripción Pro/Max. Genera el token con `claude setup-token` y guárdalo como secret `CLAUDE_CODE_OAUTH_TOKEN`; pon `LLM_PROVIDER=claude-code`. **No probado end-to-end** (se implementó según el SPEC §5b sin token disponible); si los flags del CLI cambian, ajusta [`pipeline/curate/claude-code.ts`](pipeline/curate/claude-code.ts).

## Dependencias (mínimas, justificadas)

| Paquete | Por qué |
|---|---|
| `rss-parser` | Parser RSS/Atom maduro. El XML se descarga con `fetch` propio (User-Agent + timeout) y solo se parsea con la librería. |
| `ajv` + `ajv-formats` | Validación del digest contra JSON Schema (`format: date`, `uri`). |
| `@11ty/eleventy` (dev) | Generador estático; páginas desde datos JSON, build rápido, plantillas Nunjucks. |
| `typescript` + `@types/node` (dev) | Solo para `npm run typecheck`; el runtime no compila TS. |

HTTP y ejecución de TypeScript usan capacidades nativas de Node (fetch global, *type stripping*), sin dependencias añadidas.

## Datos de ejemplo

Las ediciones de `data/2026-07-14`…`16` son **de siembra** (`provider: "seed"`): curadas a mano a partir de ítems reales para que la web tenga contenido desde el primer deploy. En la web se muestran como «vía edición de ejemplo». Se sustituirán solas por ediciones reales en cuanto el cron corra con la API key configurada.

## Operación y troubleshooting

- **El cron dejó de dispararse.** GitHub deshabilita los crons tras **60 días sin actividad**. Como el pipeline commitea a diario no debería pasar, pero si el diario deja de actualizarse sin explicación, lo primero es comprobar en `Actions` si el workflow fue deshabilitado y reactivarlo.
- **Ediciones muy finas o el workflow "no publica".** Si en la ventana de 24 h hay menos de 6 ítems, no se publica (se conserva la última edición). Sube `window_hours` en `config/sources.json` si ocurre a menudo. Los feeds de *tag* de TechCrunch, en concreto, suelen ir muy retrasados.
- **Se abrió un issue "Fallo en la edición diaria".** El workflow falló en algún paso (recogida total, curación, validación o deploy). El issue enlaza al run con los logs.
- **El token de `claude-code` dejó de valer.** Se invalida al cerrar sesión en Claude Code local; regenéralo con `claude setup-token` y actualiza el secret.
- Los triggers `schedule` son *best-effort*: pueden retrasarse minutos u horas. El diseño no depende de la hora exacta.

## Fuera de alcance (fase 2)

Resúmenes semanales/mensuales, redes sociales, newsletter, buscador, comentarios, analytics. El archivo de JSONs en `data/` es la base pensada para esa fase.
