# SPEC — Diario IA: agregador estático de noticias de Inteligencia Artificial

> Documento de especificación para Claude Code. Contiene todo el contexto, las decisiones ya tomadas y el alcance exacto del MVP. **No añadas funcionalidad fuera del alcance definido en la sección 9.**

---

## 1. Contexto y objetivo

Proyecto personal de un desarrollador individual. El objetivo es una **web estática** alojada en **GitHub Pages** que cada mañana amanece con una nueva edición: **8-10 noticias de IA de las últimas 24 horas**, curadas y resumidas **en español**, con enlace a la fuente original y un **archivo histórico navegable por fechas** (metáfora: un periódico diario).

Todo el sistema vive en un único repositorio y se ejecuta con **GitHub Actions** mediante un cron diario. No hay servidores, bases de datos ni infraestructura externa.

**Criterio de "hecho" del MVP:** durante 7 días consecutivos, a las 08:00 (Europe/Madrid) hay una edición nueva publicada sin intervención manual.

**Presupuesto:** prácticamente cero. El único coste variable es la llamada diaria al LLM (céntimos/mes).

---

## 2. Arquitectura: pipeline determinista de 5 pasos

Un único punto de entrada (script orquestador) ejecuta en orden:

1. **Recogida** — leer todas las fuentes (sección 3), quedarse con los ítems de las últimas 24 h.
2. **Normalización** — convertir todo a un formato común: `{ title, snippet, url, source, published_at }`. Deduplicación básica por URL exacta antes de llamar al LLM.
3. **Curación (LLM)** — una única llamada al proveedor configurado (sección 5) con los ítems normalizados (típicamente 50-100). Devuelve el JSON del digest conforme al schema de la sección 6. Validación externa + reintentos (sección 7).
4. **Renderizado** — el digest se guarda como `data/YYYY-MM-DD.json` y el generador estático construye la página del día, el índice histórico y la portada (que muestra la edición más reciente).
5. **Deploy** — commit + push automático desde el workflow; GitHub Pages publica.

El LLM se invoca **en modo no agentico**: es un paso más del script, con prompt fijo y salida validada. Nunca decide el flujo.

---

## 3. Fuentes de datos (todas verificadas, con feed o API pública)

### Blogs oficiales (RSS)

| Fuente | Feed | Nota |
|---|---|---|
| OpenAI News | `https://openai.com/news/rss.xml` | RSS 2.0 oficial |
| Google DeepMind | `https://deepmind.com/blog/feed/basic` | RSS oficial |
| Hugging Face Blog | `https://huggingface.co/blog/feed.xml` | Puede faltar `<link>` en items: usar `guid` como URL de respaldo |
| Anthropic News | `https://raw.githubusercontent.com/leontloveless/ai-rss-feeds/main/feeds/anthropic.xml` | **Mirror no oficial** (Anthropic no publica RSS). Tratar como fuente frágil: si falla, loguear y continuar sin abortar |

### Medios (RSS por tag)

| Fuente | Feed |
|---|---|
| TechCrunch AI | `https://techcrunch.com/tag/ai/feed/` |
| TechCrunch Artificial Intelligence | `https://techcrunch.com/tag/artificial-intelligence/feed/` |

### Comunidad (APIs JSON, sin autenticación)

**Hacker News (Algolia Search API)** — señal principal de lo que la comunidad considera importante:

```
GET https://hn.algolia.com/api/v1/search_by_date
    ?query=AI
    &tags=story
    &numericFilters=created_at_i>{now-24h en epoch segundos},points>=50
```

Respuesta JSON con array `hits` (`title`, `url`, `points`, `created_at`). Límite: 10 000 req/hora por IP (irrelevante para nuestro volumen). Hacer 2-3 consultas con queries complementarias (`AI`, `LLM`, `machine learning`) y deduplicar por URL.

**Hugging Face Hub (trending, opcional en v1):**

```
GET https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=20
```

Aporta la sección de "modelos del momento". Si mete ruido en las pruebas, desactivar mediante flag de configuración.

### Reglas generales de recogida

- Timeout por fuente (10 s) y **tolerancia a fallos**: si una fuente falla, se registra en el log y el pipeline continúa con el resto. Solo se aborta si fallan TODAS las fuentes.
- User-Agent identificable en las peticiones.
- Sin scraping de HTML en ningún caso. Solo feeds y APIs documentadas.

---

## 4. Stack técnico (decisiones cerradas)

- **Lenguaje del pipeline:** Node.js (LTS actual) con TypeScript. Sin frameworks pesados; dependencias mínimas (parser RSS maduro, validador JSON Schema tipo Ajv, y poco más).
- **Generador estático:** **Eleventy (11ty)**, elegido por simplicidad, excelente soporte de páginas generadas desde datos JSON (global data files) y build rápido. Plantillas en Nunjucks.
- **Despliegue:** GitHub Pages vía Actions (build de Eleventy → publicar `_site/`).
- **Diseño de la web:** sobrio, tipo periódico. Portada = edición del día; una URL por edición (`/2026/07/18/`); índice/archivo por meses. Sin JavaScript en cliente salvo lo imprescindible. Responsive. Idioma: español.

---

## 5. Capa de curación: proveedor LLM desacoplado

El paso 3 se implementa como una función con contrato fijo:

```
curate(items: NormalizedItem[]) → Digest   // validado contra el schema
```

Detrás, **dos implementaciones intercambiables** por variable de entorno `LLM_PROVIDER`:

### 5a. `deepseek` (proveedor principal por defecto)

- Llamada HTTP directa a la API de DeepSeek (endpoint compatible con formato OpenAI, chat completions).
- Usar **JSON mode / structured output** del proveedor.
- Credencial: secret `DEEPSEEK_API_KEY`.
- Modelo: configurable por env (`DEEPSEEK_MODEL`); verificar en la documentación de DeepSeek el identificador actual del modelo recomendado para resumen/clasificación al implementar.

### 5b. `claude-code` (fallback, coste cero vía suscripción Max)

- Invocar el CLI en modo headless dentro del workflow:

```bash
claude --bare -p "$(cat prompt_curacion.md)" \
  --output-format json \
  --json-schema "$(cat schema/digest.schema.json)" > out.json
```

- La salida útil está en el campo `structured_output` del JSON devuelto.
- Autenticación: secret `CLAUDE_CODE_OAUTH_TOKEN`, generado por el usuario con `claude setup-token` (soportado oficialmente para suscripciones Pro/Max; ver docs de `anthropics/claude-code-action` y https://code.claude.com/docs/en/github-actions).
- Los ítems normalizados se escriben a un archivo temporal y se referencia su ruta en el prompt (evitar pasar todo por stdin).
- Nota operativa: el token puede invalidarse si el usuario cierra sesión en Claude Code local; el remedio es regenerarlo y actualizar el secret.

**El prompt de curación y el schema son EXACTAMENTE los mismos para ambos proveedores.** La validación externa (sección 7) también.

---

## 6. Contrato de datos: el digest diario

Archivo `data/YYYY-MM-DD.json`, validado contra `schema/digest.schema.json`:

```json
{
  "date": "2026-07-18",
  "generated_at": "2026-07-18T05:17:03Z",
  "provider": "deepseek",
  "items": [
    {
      "rank": 1,
      "category": "lanzamientos",
      "title": "…titular reescrito en español…",
      "summary": "…2-3 frases en español…",
      "why_it_matters": "…1 frase: por qué es relevante…",
      "url": "https://fuente-original…",
      "source": "OpenAI Blog"
    }
  ]
}
```

Restricciones del schema: `items` entre 6 y 10 elementos; `category` ∈ {`lanzamientos`, `investigacion`, `industria`, `herramientas`}; `url` debe ser una de las URLs de entrada (el LLM elige, nunca inventa); todos los campos requeridos.

### Borrador del prompt de curación (iterar sobre esto, guardarlo en `prompts/curacion.md`)

Rol: editor jefe de un diario español especializado en IA. Entrada: lista numerada de ítems (título, snippet, fuente, URL, puntos si aplica). Tareas:

1. Descartar duplicados y coberturas de la misma noticia (quedarse con la fuente más primaria).
2. Descartar contenido irrelevante, promocional o de baja señal.
3. Seleccionar las 8-10 noticias más relevantes del día, priorizando: lanzamientos de modelos/productos > investigación con impacto > movimientos de industria > herramientas.
4. Para cada una: titular propio en español, resumen de 2-3 frases, una frase de "por qué importa", categoría, y la URL original **copiada literalmente de la entrada**.
5. Responder ÚNICAMENTE con el JSON conforme al schema. Nada de texto adicional.

---

## 7. Validación y manejo de fallos

- Validar la salida del LLM con **Ajv** contra el schema. Comprobación extra fuera del schema: cada `url` del digest existe en los ítems de entrada.
- Si la validación falla: **hasta 2 reintentos**, añadiendo al prompt el error de validación concreto. Si tras los reintentos sigue fallando: el pipeline termina con exit code ≠ 0 **sin publicar nada** (la web conserva la última edición buena).
- Ante fallo del workflow (cualquier paso): un step final con `if: failure()` **abre un issue en el repo** con el log resumido, para que el fallo sea visible sin mirar Actions.
- Guardar siempre la salida cruda del LLM en logs del workflow (artifact) para depuración.
- Idempotencia: si ya existe `data/YYYY-MM-DD.json` del día, el pipeline no vuelve a llamar al LLM (permite re-runs seguros del workflow).

---

## 8. Workflow de GitHub Actions

Un único workflow `daily.yml`:

- **Trigger:** `schedule` con cron en hora NO redonda para minimizar retrasos de la cola de GitHub (p. ej. `17 4 * * *` UTC ≈ 06:17 CEST) + `workflow_dispatch` para ejecuciones manuales.
- **Pasos:** checkout → setup Node → install → ejecutar pipeline → build Eleventy → commit/push → deploy Pages.
- **Commit/push:** usar el `GITHUB_TOKEN` del workflow (no PAT). Configurar `user.name`/`user.email` genéricos y comprobar `git status --porcelain` para no crear commits vacíos. Mensaje: `edición YYYY-MM-DD`.
- **Auto-desactivación:** GitHub desactiva los crons tras 60 días sin actividad en el repo. Como el pipeline commitea a diario esto no debería ocurrir, pero documentar en el README que si el cron muere sin explicación, lo primero es comprobar si el workflow fue deshabilitado.
- **Secrets necesarios:** `DEEPSEEK_API_KEY` (y opcionalmente `CLAUDE_CODE_OAUTH_TOKEN` si se activa el fallback).
- Los triggers `schedule` son best-effort y pueden retrasarse minutos u horas en picos: el diseño lo asume (no hay dependencias de hora exacta).

---

## 9. Fuera de alcance del MVP (NO implementar)

Resúmenes semanales/mensuales/anuales · publicación en redes sociales (X/LinkedIn) · newsletter · buscador interno · scraping de HTML · Twitter/LinkedIn como fuentes · comentarios · analytics.

El diseño sí debe **dejar la puerta abierta**: el archivo de JSONs diarios en `data/` es la base sobre la que se construirán los resúmenes multi-escala y la capa de distribución en una fase 2.

---

## 10. Estructura de repositorio propuesta

```
/
├── SPEC.md                  ← este documento
├── README.md                ← setup, secrets, operación, troubleshooting
├── .github/workflows/daily.yml
├── pipeline/                ← TypeScript del pipeline
│   ├── index.ts             ← orquestador
│   ├── sources/             ← un módulo por fuente
│   ├── normalize.ts
│   ├── curate/
│   │   ├── index.ts         ← selector de proveedor
│   │   ├── deepseek.ts
│   │   └── claude-code.ts
│   └── validate.ts
├── prompts/curacion.md
├── schema/digest.schema.json
├── data/                    ← un JSON por día (histórico)
├── site/                    ← proyecto Eleventy
└── config/sources.json      ← fuentes activables/desactivables sin tocar código
```

---

## 11. Instrucciones de trabajo para Claude Code

1. Construye en este orden y verifica cada fase antes de la siguiente: (a) recogida + normalización con salida a consola, (b) curación con proveedor DeepSeek + validación, (c) sitio Eleventy renderizando desde `data/`, (d) workflow completo, (e) fallback claude-code.
2. Escribe tests para: normalización de feeds (con fixtures reales descargados), validación del schema, y la comprobación de URLs del digest.
3. No inventes fuentes ni endpoints: usa exactamente los de la sección 3. Si alguno no responde durante el desarrollo, márcalo como desactivado en `config/sources.json` y repórtalo, no lo sustituyas por otro.
4. Dependencias: las mínimas. Justifica cada una en el README.
5. El README debe permitir a cualquiera clonar, configurar secrets y tener el diario funcionando en menos de 15 minutos.
6. Genera 2-3 días de datos de ejemplo ejecutando el pipeline manualmente, para que la web tenga contenido desde el primer deploy.
