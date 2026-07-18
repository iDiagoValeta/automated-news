# La Terminal

Diario estático de noticias de tecnología en español, centrado en la IA y en herramientas prácticas. Cada mañana (09:00 hora de Madrid) publica una edición con hasta 20 noticias del día, resumidas y con enlace a la fuente original, más un botón por noticia para copiarla lista para publicar en X y LinkedIn. Incluye una sección de **repositorios hot de GitHub** (en su propia pestaña) y un archivo histórico navegable por fechas, tanto de noticias como de repositorios. Se genera con un workflow de GitHub Actions y se sirve en GitHub Pages. No hay servidores ni base de datos.

- Sitio: https://idiagovaleta.github.io/automated-news/
- Flujo técnico detallado: [docs/flujo-tecnico.md](docs/flujo-tecnico.md)

## Cómo funciona

Un único script orquestador ([`pipeline/index.ts`](pipeline/index.ts)) ejecuta estos pasos:

1. **Recogida.** Lee las fuentes de [`config/sources.json`](config/sources.json) (RSS de blogs de laboratorios, medios tecnológicos generalistas y la API de Hacker News) y toma lo publicado en las últimas 24 horas. En paralelo recoge los repositorios en tendencia de GitHub ([`pipeline/sources/github.ts`](pipeline/sources/github.ts)). Si una fuente falla se registra y se continúa; solo aborta si fallan todas.
2. **Normalización.** Formato común `{ title, snippet, url, source, published_at }` y deduplicación por URL canónica.
3. **Enriquecimiento.** Para los candidatos con más señal, descarga la página y extrae texto real del artículo ([`pipeline/enrich.ts`](pipeline/enrich.ts)), para que los resúmenes no dependan solo del titular. Tolerante a fallos y paywalls.
4. **Curación y validación.** Una llamada al modelo devuelve el digest del día en JSON (hasta 20 noticias), eligiendo y redactando en español. El criterio editorial da prioridad a la IA y a lo práctico y aplicable, y deja el mercado y lo financiero al fondo; el destacado siempre es de IA. Nunca inventa URLs. Se valida con Ajv contra [`schema/digest.schema.json`](schema/digest.schema.json) más la comprobación de que cada URL existe en la entrada. Hasta dos reintentos; si sigue sin validar, no se publica.
5. **Posts sociales.** Una segunda tanda de llamadas al modelo, una por noticia, redacta el texto para X y para LinkedIn ([`pipeline/curate/social.ts`](pipeline/curate/social.ts)). Es best effort: si falla, la edición se publica igual sin posts.
6. **Repositorios hot.** Una tercera llamada al modelo elige los repos más interesantes de la tendencia de GitHub (IA y herramientas prácticas primero) y los describe en castellano ([`pipeline/curate/repos.ts`](pipeline/curate/repos.ts)). Best effort: si falla, la edición sale sin la sección.
7. **Renderizado y publicación.** El digest se guarda en `data/YYYY-MM-DD.json`, Eleventy construye el sitio y GitHub Pages lo sirve.

El modelo se usa como un paso más del script, con prompts fijos ([`prompts/`](prompts/)) y salida validada.

## El sitio

La cabecera tiene tres pestañas:

- **Noticias**: la edición del día (`/`, `/AAAA/MM/DD/`).
- **Repositorios**: los repos hot del día (`/repositorios/`, `/repositorios/AAAA/MM/DD/`).
- **Archivo**: un índice que enlaza al archivo de noticias (`/archivo/noticias/`) y al de repositorios (`/archivo/repositorios/`).

Noticias y repositorios comparten **exactamente la misma estructura y navegación**: la pestaña activa se resalta en la cabecera; arriba hay un botón **Calendario** que despliega un popover donde solo se pueden elegir los días con edición publicada (abierto por defecto en el día actual); la fecha se muestra en un `dateline` sobre el contenido; y una barra inferior lleva al día anterior o siguiente. Entre secciones solo cambia el contenido, no la forma de moverse.

## Uso en local

Requiere Node.js 24 o superior (el pipeline es TypeScript ejecutado con el *type stripping* nativo de Node, sin paso de compilación).

```bash
git clone https://github.com/iDiagoValeta/automated-news.git
cd automated-news
npm install

npm run pipeline -- --collect-only   # imprime los ítems normalizados, sin llamar al modelo
npm test                             # normalización, validación, parser de trending y ensamblado social
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

Incluye blogs de laboratorios (OpenAI, DeepMind, Anthropic, Hugging Face), medios tecnológicos (TechCrunch, The Verge, Ars Technica, The Register, Wired, Engadget, MIT Technology Review), la comunidad (Hacker News, Lobsters) y las tendencias de GitHub. Cada fuente se activa o desactiva con `enabled`. Campos globales: `window_hours` (ventana temporal), `candidate_cap` (máximo de candidatos que pasan a curación), `enrich_top` (cuántos se enriquecen leyendo el artículo), `timeout_ms` y `user_agent`. La fuente de Anthropic es un mirror no oficial marcado como `fragile`: si falla, se ignora sin abortar.

El bloque `github_trending` configura la sección de repos: `since` (ventana de tendencia, `daily` por defecto), `limit` (cuántos repos se recogen para pasar al modelo) y `pick` (cuántos elige el modelo). La recogida intenta el scraping de `github.com/trending` y, si falla, cae a la Search API oficial.

Reddit no está incluido: su JSON público devuelve 403 sin OAuth y bloquea las IP de datacenter donde corre GitHub Actions. La señal de comunidad se cubre con Hacker News y Lobsters.

### Variables de entorno

| Variable | Uso |
|---|---|
| `DEEPSEEK_API_KEY` | Credencial del proveedor principal (secret). |
| `DEEPSEEK_MODEL` | Modelo de DeepSeek. Por defecto `deepseek-v4-pro`. Alternativa más barata: `deepseek-v4-flash`. |
| `LLM_PROVIDER` | `deepseek` (por defecto) o `claude-code`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Solo para el proveedor `claude-code`. |
| `GITHUB_TOKEN` | Opcional. Solo lo usa el fallback de la Search API de GitHub; en Actions se provee de forma automática. |

### Despliegue

En `Settings, Pages` el origen es *GitHub Actions*. El secret `DEEPSEEK_API_KEY` se configura en `Settings, Secrets and variables, Actions`. El workflow [`daily.yml`](.github/workflows/daily.yml) publica a las 09:00 hora de Madrid y admite ejecución manual desde la pestaña Actions (con la opción `skip_pipeline` para redesplegar el sitio sin regenerar la edición). Como el cron de GitHub solo entiende UTC y España cambia de hora, se disparan dos cron (07:09 y 08:09 UTC) y un guardián solo deja publicar cuando en Madrid ya son las 09:00; la idempotencia evita publicar dos veces. Antes de publicar, el workflow reintegra los cambios remotos (`git pull --rebase`) para que un push concurrente no tumbe la edición.

## Compartir en redes

Cada noticia tiene dos botones (X y LinkedIn) que copian al portapapeles un texto listo para pegar. Los redacta el modelo, una llamada por noticia, y el pipeline los monta ([`pipeline/curate/social.ts`](pipeline/curate/social.ts)). En ambas redes el **gancho va como primera línea**, para frenar el scroll. El de X es texto plano recortado para caber en 280 caracteres (en X las letras en negrita cuentan el doble, y la URL cuenta como 23). El de LinkedIn no tiene límite práctico: abre con el gancho y la idea clave va en **negrita** (caracteres Unicode, porque LinkedIn no renderiza markdown). Es lo único que aporta JavaScript de cliente ([`site/js/compartir.js`](site/js/compartir.js)).

## Proveedor de fallback: `claude-code`

Alternativa a DeepSeek vía suscripción Pro o Max. El token se genera con `claude setup-token` y se guarda como secret `CLAUDE_CODE_OAUTH_TOKEN`; se activa con `LLM_PROVIDER=claude-code`. La implementación ([`pipeline/curate/claude-code.ts`](pipeline/curate/claude-code.ts)) no está probada end to end.

## Previsto: resúmenes agrupados

Además de la edición diaria, está previsto generar **resúmenes agrupados** que den contexto sobre la evolución del año a partir de las ediciones ya publicadas:

- **Semanales**: recopilación de lo más relevante de la semana.
- **Mensuales**: las tendencias e hitos del mes.
- **Anuales**: la panorámica del año.

La idea es agrupar las ediciones diarias (los `data/YYYY-MM-DD.json`) por periodo, pasar ese material a una nueva pasada del modelo y publicar cada resumen con su propia página y archivo, en la misma línea que las secciones actuales. Todavía no está implementado; se documentará aquí y en [docs/flujo-tecnico.md](docs/flujo-tecnico.md) cuando lo esté.

## Dependencias

| Paquete | Para qué |
|---|---|
| `rss-parser` | Parser RSS y Atom. El XML se descarga con `fetch` propio (User-Agent y timeout) y solo se parsea con la librería. |
| `ajv` y `ajv-formats` | Validación del digest contra JSON Schema. |
| `@11ty/eleventy` (dev) | Generador estático con plantillas Nunjucks. |
| `typescript` y `@types/node` (dev) | Solo para `npm run typecheck`. |

HTTP, el scraping de GitHub y la ejecución de TypeScript usan capacidades nativas de Node, sin dependencias añadidas.

## Notas de operación

- GitHub deshabilita los crons tras 60 días sin actividad en el repo. Si el sitio deja de actualizarse sin motivo aparente, lo primero es comprobar en Actions si el workflow sigue habilitado.
- Si en la ventana de 24 horas hay menos de seis ítems, no se publica edición y se conserva la última. `window_hours` en `config/sources.json` amplía la ventana. Los feeds de *tag* de TechCrunch suelen ir retrasados.
- Cuando el workflow falla en algún paso, abre un issue con enlace al run.
- Los triggers `schedule` de GitHub son best effort y pueden retrasarse; el diseño no depende de la hora exacta.
