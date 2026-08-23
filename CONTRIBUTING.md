# Contribuir a La Terminal

Estándar para abrir issues y pull requests en este repositorio. Se aplica a colaboradores externos y al mantenimiento propio: el objetivo es que cualquier cambio sea pequeño, verificable y coherente con las decisiones de diseño del proyecto.

## Antes de empezar

- Node.js 22.6 o superior y pnpm (`corepack enable`).
- Instalación: `pnpm install --frozen-lockfile`.
- Verificación local (debe pasar antes de abrir un PR):

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Si tu cambio toca fuentes, recogida o configuración, comprueba además la recogida sin consumir LLM:

```bash
pnpm run pipeline -- --collect-only
```

No hay workflow de CI para PRs: la verificación es responsabilidad de quien abre el PR, y se indica en la descripción cómo se ha comprobado.

## Reglas del proyecto

Un cambio no puede romper estas decisiones (detalladas en [README](README.md) y [docs/flujo-tecnico.md](docs/flujo-tecnico.md)):

1. **Estático por defecto.** Sin servidor ni base de datos; las ediciones son JSON versionados en Git.
2. **Fuentes por delante del modelo.** El LLM selecciona y redacta, pero nunca inventa URL ni metadatos. Toda salida se valida contra `schema/digest.schema.json` y contra pertenencia a la entrada.
3. **Best effort.** Un fallo secundario (una fuente, un artículo, un post social) nunca bloquea la edición completa.
4. **Idempotencia diaria.** Existe una edición por fecha civil en `Europe/Madrid`. No subas a `main` un `data/YYYY-MM-DD.json` generado en local sin saber lo que haces: bloquearías la generación oficial de ese día.
5. **Español de España** en textos de interfaz, documentación y commits. Prohibidas la raya (—) y el guion medio (–): usa comas, paréntesis o dos puntos. Los tecnicismos que el sector usa en inglés se dejan en inglés (*deploy*, *framework*, *commit*).
6. **Cambios quirúrgicos.** Cada línea del diff debe trazar al propósito del PR. No se refactoriza lo que no está roto ni se "mejora" código adyacente.

Nunca commites claves ni tokens. Las credenciales van solo en variables de entorno o secrets de GitHub.

## Issues

Antes de abrir uno, busca si ya existe otro igual. Un issue trata un único tema y su título es una frase corta e imperativa en español ("Añadir feed RSS del diario", "Corregir deduplicación de URL con mayúsculas").

### Tipos y etiquetas

| Tipo | Etiqueta | Para qué |
|---|---|---|
| Fallo | `bug` | Algo funciona mal hoy. |
| Mejora | `enhancement` | Funcionalidad nueva o cambio de comportamiento. |
| Fuente nueva | `fuente-nueva` | Proponer un RSS o API como fuente. |
| Documentación | `documentation` | README, docs, prompts, este estándar. |
| Distribución | `distribucion` | RSS del diario, SEO, redes, newsletter. |
| Robustez | `robustez` | Failover, alertas, tolerancia a fallos del pipeline. |
| Fallo automático | `fallo-automatico` | Lo abre el workflow diario al fallar; no crear manualmente. |

### Plantillas

Copia la plantilla que corresponda en el cuerpo del issue y rellénala.

Bug:

```markdown
### Qué pasa
Descripción breve del síntoma.

### Cómo reproducirlo
Pasos exactos, o enlace al run/log de Actions si es del pipeline diario.

### Qué debería pasar
Comportamiento esperado.

### Evidencia
Logs, extractos de data/*.json o capturas.
```

Propuesta de fuente:

```markdown
### Fuente
- Nombre:
- URL del feed:
- Tipo: RSS / Atom / API

### Por qué encaja
Qué aporta según la línea editorial: IA como eje, prioridad a lo práctico y aplicable.

### Verificación hecha
Confirma que has comprobado: el feed responde 200, es XML válido y publica con suficiente frecuencia (los blogs semanales son válidos).
```

Mejora:

```markdown
### Problema u oportunidad
Qué necesidad real atiende.

### Propuesta
Cómo lo implementarías, con qué alcance mínimo.

### Criterio de aceptación
Cómo sabremos que está hecho y verificado.
```

## Pull requests

### Flujo

1. Rama nueva desde `main` actualizado. Nombres en kebab-case con prefijo de tipo: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
2. Un PR, un propósito. Si necesitas dos cambios no relacionados, dos PRs.
3. Commits en español, estilo del historial: frase corta que describa el cambio ("Añade fuentes RSS de laboratorios", "Corrige el guardián horario"). Referencias durables a issues cuando aplique (`#123`); nunca referencias a pasos internos de un plan.
4. PR hacia `main`. En la descripción: qué cambia, por qué, y cómo se ha verificado (comandos ejecutados y resultado).
5. Merge por squash para mantener el historial lineal, y borrado de la rama tras integrar.

### Checklist antes de abrir

- [ ] `pnpm test`, `pnpm run typecheck` y `pnpm run build` pasan en local.
- [ ] Si toca fuentes o recogida: `--collect-only` ejecutado y resultados revisados.
- [ ] El diff no toca `data/` salvo ediciones reales generadas por el pipeline.
- [ ] Textos nuevos en español de España, sin rayas ni guiones medios.
- [ ] Sin secretos ni credenciales en el diff.
- [ ] La descripción explica qué, por qué y cómo se ha verificado.

### Qué se revisa

- Alineación con las reglas del proyecto (sección anterior).
- Tamaño y foco del diff: un PR grande que mezcla temas pide dividirse.
- Cobertura del cambio: todo comportamiento nuevo o corregido lleva test en `pipeline/__tests__/` cuando es verificable sin red. Los tests usan fixtures locales, nunca llamadas reales.
- Convenciones del código existente: TypeScript con type stripping nativo de Node (sin enums ni sintaxis que requiera transpilar), comentarios en español explicando el porqué.
