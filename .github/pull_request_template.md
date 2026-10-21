## Issue enlazado

Closes #

## Qué cambia

## Por qué

## Cómo se ha verificado

Comandos ejecutados y resultado:

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Si toca fuentes o recogida: `pnpm run pipeline -- --collect-only`.

## Checklist

- [ ] `pnpm test`, `pnpm run typecheck` y `pnpm run build` pasan en local (el CI las repetirá).
- [ ] Si toca fuentes o recogida: `--collect-only` ejecutado y resultados revisados.
- [ ] El diff no toca `data/` salvo ediciones reales generadas por el pipeline.
- [ ] Textos nuevos en español de España, sin rayas ni guiones medios.
- [ ] Sin secretos ni credenciales en el diff.
- [ ] La descripción explica qué, por qué y cómo se ha verificado.
