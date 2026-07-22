# La Terminal

La actualidad tecnológica, cada mañana.

[La Terminal](https://idiagovaleta.github.io/automated-news/) es un diario estático en español que reúne las noticias tecnológicas más relevantes y los repositorios open source que están ganando tracción. El pipeline recoge las fuentes, elimina duplicados, amplía el contexto, selecciona lo importante con un LLM y publica una edición navegable en GitHub Pages.

No necesita servidor ni base de datos: cada edición queda guardada como JSON dentro del propio repositorio.

## Qué ofrece

- Hasta 20 noticias diarias, resumidas en español y enlazadas a la fuente original.
- Repositorios trending de GitHub seleccionados por utilidad, con prioridad para IA y herramientas prácticas.
- Una ventana de siete días que evita repetir repositorios publicados recientemente.
- Posts para X y LinkedIn listos para copiar desde cada noticia y repositorio.
- Archivo por fechas, calendario y navegación entre ediciones.
- Publicación automática mediante GitHub Actions y GitHub Pages.
- Tolerancia a fallos: una fuente, artículo o post social puede fallar sin bloquear toda la edición.

**Web:** https://idiagovaleta.github.io/automated-news/

## Cómo funciona

```text
RSS + Hacker News + GitHub Trending
                  │
                  ▼
        normalización y deduplicación
                  │
                  ▼
      enriquecimiento de los artículos
                  │
                  ▼
       curación y validación con LLM
                  │
          ┌───────┴────────┐
          ▼                ▼
    posts sociales    repositorios hot
          └───────┬────────┘
                  ▼
          data/YYYY-MM-DD.json
                  │
                  ▼
        Eleventy → GitHub Pages
```

El modelo nunca decide los datos duros. Las URL, nombres de repositorio, lenguajes y estrellas proceden de las fuentes recogidas; el LLM se limita a seleccionar y redactar. La salida principal se valida con [JSON Schema](schema/digest.schema.json) y se comprueba que cada URL pertenezca a la entrada.

El flujo técnico completo está documentado en [docs/flujo-tecnico.md](docs/flujo-tecnico.md).

## Tecnologías

- Node.js y TypeScript ejecutado directamente mediante type stripping.
- Eleventy 3 y Nunjucks para el sitio estático.
- Ajv para validar cada edición.
- DeepSeek como proveedor LLM principal.
- GitHub Actions para generar, versionar y desplegar.

## Ejecutarlo en local

### Requisitos

- Node.js 22.6 o superior. Node.js 24 es la versión usada en CI.
- npm.

```bash
git clone https://github.com/iDiagoValeta/automated-news.git
cd automated-news
npm ci
```

Comprobar la recogida sin utilizar un LLM:

```bash
npm run pipeline -- --collect-only
```

Ejecutar las comprobaciones:

```bash
npm test
npm run typecheck
npm run build
```

Abrir el sitio en desarrollo:

```bash
npm run dev
```

Eleventy lo servirá bajo `http://localhost:8080/automated-news/`.

### Generar una edición

Por defecto se usa DeepSeek:

```bash
export DEEPSEEK_API_KEY=sk-...
npm run pipeline
```

En PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
npm run pipeline
```

El resultado se escribe en `data/YYYY-MM-DD.json`. El pipeline es idempotente: si la edición de hoy ya existe, no vuelve a consumir el proveedor.

## Configuración

Las fuentes y límites se definen en [config/sources.json](config/sources.json):

- `window_hours`: ventana temporal de las noticias.
- `candidate_cap`: máximo de candidatos antes de la curación.
- `enrich_top`: artículos que se intentan ampliar leyendo la página original.
- `rss`: fuentes RSS o Atom activables individualmente.
- `hackernews`: consultas y puntuación mínima.
- `github_trending`: periodo, candidatos recogidos y repositorios seleccionados.

Variables de entorno:

| Variable | Uso |
|---|---|
| `DEEPSEEK_API_KEY` | Credencial de DeepSeek. |
| `DEEPSEEK_MODEL` | Modelo de DeepSeek; por defecto, `deepseek-v4-pro`. |
| `LLM_PROVIDER` | `deepseek` o `claude-code`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Credencial del proveedor alternativo `claude-code`. |
| `GITHUB_TOKEN` | Opcional para el fallback de GitHub Search API. |

Sin la credencial del proveedor seleccionado no se crea una edición, pero el proceso termina correctamente y conserva la última publicada.

## Publicación automática

El workflow [`.github/workflows/daily.yml`](.github/workflows/daily.yml):

1. Se intenta varias veces cada mañana para absorber posibles retrasos del cron de GitHub.
2. Un guardián comprueba que en Madrid sean al menos las 09:00.
3. Genera la edición una sola vez gracias a la idempotencia por fecha.
4. Ejecuta el build, versiona el nuevo JSON y despliega `_site` en GitHub Pages.
5. Abre un issue con el enlace al run si el workflow falla.

También admite ejecución manual y una opción `skip_pipeline` para reconstruir el sitio sin generar datos nuevos.

El `pathPrefix` de Eleventy está configurado como `/automated-news/`. Si despliegas un fork con otro nombre, actualízalo en [`eleventy.config.mjs`](eleventy.config.mjs).

## Estructura

```text
config/                 fuentes y límites
data/                   ediciones publicadas
docs/                   documentación técnica
pipeline/               recogida, curación y validación
  __tests__/             tests y fixtures
  curate/                proveedores, prompts sociales y repos
  sources/               RSS, Hacker News, GitHub y fuente opcional de Hugging Face
prompts/                 instrucciones editoriales para el LLM
schema/                  JSON Schema del digest
site/                    plantillas, estilos y JavaScript
.github/workflows/       generación y despliegue diarios
```

Los JSON históricos forman parte del producto: alimentan el archivo público, la navegación y el filtro que evita repetir repositorios durante siete días.

## Decisiones de diseño

- **Estático por defecto.** Menos infraestructura, coste y superficie de fallo.
- **Fuentes por delante del modelo.** El LLM redacta, pero no inventa enlaces ni metadatos.
- **Best effort.** Los fallos secundarios no impiden publicar contenido válido.
- **Datos versionados.** Cada edición queda auditable en Git.
- **Posts listos para usar.** X respeta el límite de 280 caracteres y pondera cada URL como 23; LinkedIn usa un formato más desarrollado.

## Licencia

Este repositorio no incluye todavía una licencia de uso. El código se publica para consulta, pero no se concede automáticamente permiso para reutilizarlo o redistribuirlo.
