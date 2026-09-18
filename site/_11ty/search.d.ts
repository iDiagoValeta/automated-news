export interface SearchDoc {
  title: string;
  summary: string;
  source: string;
  category: string;
  date: string;
  path: string;
}

export function buildSearchIndex(editions: unknown[]): SearchDoc[];
export function tokenize(query: string): string[];
export function searchDocs(index: SearchDoc[], query: string): SearchDoc[];
