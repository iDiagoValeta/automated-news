import type { SearchDoc } from "./search.js";

export interface EditorialItem {
  fileSlug?: string;
  url?: string;
  date?: Date | string;
  data: {
    title?: string;
    resumen?: string;
    fechaISO?: string;
    draft?: boolean;
    [key: string]: unknown;
  };
}

export function fechaISO(valor: unknown): string;
export function fechaNota(valor: unknown, fichero?: string): string;
export function fechaFrontMatter(texto: string, fichero?: string): string;
export function textoObligatorio(valor: unknown, campo: string, fichero?: string): string;
export function notaPath(slug: string): string;
export function notasPublicadas(items?: EditorialItem[]): EditorialItem[];
export function notaSearchEntry(item: EditorialItem): SearchDoc;
export function searchIndexConNotas(
  base: SearchDoc[] | undefined,
  items: EditorialItem[] | undefined,
): SearchDoc[];
export function sitemapPathsConNotas(
  paths: string[] | undefined,
  items: EditorialItem[] | undefined,
): string[];
