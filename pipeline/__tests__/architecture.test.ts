import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Contrato de arquitectura: el núcleo y los puertos no pueden depender de
// adaptadores ni de la raíz de composición. Sin dependencias: regex sobre imports.

export interface HexConfig {
  core: string[];
  ports: string[];
  driven_adapters: string[];
  composition_root: string[];
  forbidden_in_core: string[];
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

export function specifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2]);
}

/** Ruta relativa a la raíz del repo a la que apunta un especificador, o null si es un paquete. */
function resolveSpec(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return resolve(dirname(join(ROOT, file)), spec).slice(ROOT.length);
}

function inside(target: string, entries: string[]): boolean {
  return entries.some((e) => target === e || target.startsWith(e + "/"));
}

/** `files` mapea ruta relativa (núcleo o puertos) a su contenido. */
export function violations(files: Record<string, string>, cfg: HexConfig): string[] {
  const out: string[] = [];
  const forbiddenTargets = [...cfg.driven_adapters, ...cfg.composition_root];
  for (const [file, source] of Object.entries(files)) {
    for (const spec of specifiers(source)) {
      const target = resolveSpec(file, spec);
      if (cfg.forbidden_in_core.includes(spec)) {
        out.push(`${file}: importa "${spec}" (prohibido en el núcleo)`);
      } else if (target && inside(target, forbiddenTargets)) {
        out.push(`${file}: importa "${spec}" (adaptador o raíz de composición)`);
      }
    }
  }
  return out;
}

const cfg = JSON.parse(readFileSync(join(ROOT, ".hexagonal.json"), "utf8")) as HexConfig;

test("el núcleo y los puertos no importan adaptadores ni raíz de composición", () => {
  const files: Record<string, string> = {};
  for (const f of [...cfg.core, ...cfg.ports]) files[f] = readFileSync(join(ROOT, f), "utf8");
  assert.deepEqual(violations(files, cfg), []);
});

test("la regla muerde: un fichero de núcleo que importa ../http.ts se detecta", () => {
  const synthetic = { "pipeline/curate/malo.ts": 'import { fetchText } from "../http.ts";\n' };
  const found = violations(synthetic, cfg);
  assert.equal(found.length, 1);
  assert.match(found[0], /\.\.\/http\.ts/);
});

test("la regla muerde: paquetes prohibidos y adaptadores hermanos se detectan", () => {
  const synthetic = {
    "pipeline/normalize.ts": 'import Parser from "rss-parser";\nexport { x } from "./curate/deepseek.ts";\n',
  };
  assert.equal(violations(synthetic, cfg).length, 2);
});
