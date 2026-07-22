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
  /** Texto extraído del artículo real (paso de enriquecimiento). */
  content?: string;
}

/** Texto listo para pegar en cada red social. */
export interface SocialPosts {
  x: string;
  linkedin: string;
}

/** Repositorio en tendencia recogido de GitHub, antes de pasar por el modelo. */
export interface RepoRaw {
  /** owner/repo. */
  name: string;
  url: string;
  /** Descripción original de GitHub (suele estar en inglés; puede faltar). */
  description: string;
  language: string;
  /** Estrellas totales. */
  stars: number;
  /** Estrellas ganadas en el periodo (0 si no se conoce, p. ej. vía Search API). */
  stars_today: number;
}

/** Repositorio ya curado para la sección "Repositorios hot", con descripción en español. */
export interface Repo {
  name: string;
  url: string;
  description: string;
  language?: string;
  stars?: number;
  /** Posts listos para publicar; se rellenan tras la curación de repos. */
  social?: SocialPosts;
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
  /** Posts listos para publicar; se rellenan en la segunda llamada al LLM. */
  social?: SocialPosts;
}

export interface Digest {
  date: string;
  generated_at: string;
  provider: ProviderName;
  items: DigestItem[];
  /** Sección "Repositorios hot"; se rellena en una tercera llamada al LLM (best effort). */
  repos?: Repo[];
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

export interface GithubTrendingConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** Ventana de tendencia de GitHub. */
  since: "daily" | "weekly" | "monthly";
  /** Cuántos repos en tendencia se recogen para pasar al modelo. */
  limit: number;
  /** Cuántos elige el modelo para la sección. */
  pick: number;
}

export interface SourcesConfig {
  user_agent: string;
  timeout_ms: number;
  window_hours: number;
  /** Máximo de candidatos que pasan a curación. */
  candidate_cap: number;
  /** Cuántos de los candidatos con más señal se enriquecen leyendo el artículo. */
  enrich_top: number;
  enrich_timeout_ms: number;
  rss: RssSource[];
  hackernews: HackerNewsConfig;
  huggingface_trending: HfTrendingConfig;
  github_trending: GithubTrendingConfig;
}
