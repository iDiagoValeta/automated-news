import { log, warn } from "../log.ts";
import type { NewsItem, SourcesConfig } from "../types.ts";
import { collectRss } from "./rss.ts";
import { collectHackerNews } from "./hackernews.ts";
import { collectHfTrending } from "./huggingface.ts";

interface SourceTask {
  name: string;
  fragile: boolean;
  run: () => Promise<NewsItem[]>;
}

export interface CollectResult {
  items: NewsItem[];
  attempted: number;
  succeeded: number;
  failures: string[];
}

/**
 * Ejecuta todas las fuentes habilitadas en paralelo con tolerancia a fallos.
 * Una fuente que falla se registra y se omite; solo se considera fatal si
 * fallan TODAS (el orquestador decide qué hacer con eso).
 */
export async function collectAll(cfg: SourcesConfig): Promise<CollectResult> {
  const tasks: SourceTask[] = [];

  for (const s of cfg.rss) {
    if (s.enabled) tasks.push({ name: s.name, fragile: s.fragile, run: () => collectRss(s, cfg) });
  }
  if (cfg.hackernews.enabled) {
    tasks.push({ name: cfg.hackernews.name, fragile: false, run: () => collectHackerNews(cfg, cfg.hackernews) });
  }
  if (cfg.huggingface_trending.enabled) {
    tasks.push({
      name: cfg.huggingface_trending.name,
      fragile: false,
      run: () => collectHfTrending(cfg, cfg.huggingface_trending),
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  const items: NewsItem[] = [];
  const failures: string[] = [];
  let succeeded = 0;

  settled.forEach((res, i) => {
    const task = tasks[i];
    if (res.status === "fulfilled") {
      succeeded++;
      items.push(...res.value);
      log(`Fuente "${task.name}": ${res.value.length} ítems`);
    } else {
      failures.push(task.name);
      const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
      const level = task.fragile ? "(frágil, se ignora) " : "";
      warn(`Fuente "${task.name}" falló ${level}`, reason);
    }
  });

  return { items, attempted: tasks.length, succeeded, failures };
}
