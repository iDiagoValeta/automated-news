// Tipos compartidos del pipeline. Sin enums ni sintaxis no borrable
// (el pipeline se ejecuta con el "type stripping" nativo de Node).

/** Ítem recogido de una fuente y ya normalizado al formato común. */
export interface NewsItem {
  title: string;
  snippet: string;
  url: string;
  source: string;
  /** ISO 8601 UTC. */
  published_at: string;
  /** Solo Hacker News: votos de la comunidad. */
  points?: number;
}

export type ProviderName = "deepseek" | "claude-code";

export type Category =
  | "lanzamientos"
  | "investigacion"
  | "industria"
  | "herramientas";

export interface DigestItem {
  rank: number;
  category: Category;
  title: string;
  summary: string;
  why_it_matters: string;
  url: string;
  source: string;
}

export interface Digest {
  date: string;
  generated_at: string;
  provider: ProviderName;
  items: DigestItem[];
}

// ---- Configuración (config/sources.json) ----

export interface RssSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  fragile: boolean;
}

export interface HackerNewsConfig {
  id: string;
  name: string;
  enabled: boolean;
  min_points: number;
  queries: string[];
}

export interface HfTrendingConfig {
  id: string;
  name: string;
  enabled: boolean;
  limit: number;
}

export interface SourcesConfig {
  user_agent: string;
  timeout_ms: number;
  window_hours: number;
  rss: RssSource[];
  hackernews: HackerNewsConfig;
  huggingface_trending: HfTrendingConfig;
}
