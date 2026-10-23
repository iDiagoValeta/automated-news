import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachLecturas,
  excludeRecentLecturas,
  loadRecentLecturaUrls,
} from "../curate/lecturas.ts";
import { canonicalUrl, normalize } from "../normalize.ts";
import { collectLecturas, roundRobinBySource } from "../sources/lecturas.ts";
import { validateDigest } from "../validate.ts";
import type { Provider } from "../ports.ts";
import type {
  Digest,
  DigestItem,
  LecturaTema,
  LecturasConfig,
  NewsItem,
  RssSource,
  SourcesConfig,
} from "../types.ts";

const PUBLISHED_AT = "2026-10-20T08:00:00.000Z";

function candidates(): NewsItem[] {
  return [
    {
      title: "Aprender Rust",
      snippet: "Extracto de la primera.",
      url: "https://medium.com/@alguien/rust",
      source: "Medium: Programming",
      published_at: PUBLISHED_AT,
    },
    {
      title: "Depurar en producción",
      snippet: "Extracto de la segunda.",
      url: "https://jvns.ca/depurar",
      source: "Julia Evans",
      published_at: PUBLISHED_AT,
    },
    {
      title: "Diseñar APIs",
      snippet: "Extracto de la tercera.",
      url: "https://martinfowler.com/apis",
      source: "Martin Fowler",
      published_at: PUBLISHED_AT,
    },
  ];
}

function emptyDigest(): Digest {
  return {
    date: "2026-10-24",
    generated_at: "2026-10-24T05:00:00.000Z",
    provider: "deepseek",
    items: [],
  };
}

function providerReplying(payload: unknown): Provider {
  return { name: "deepseek", generate: async () => JSON.stringify(payload) };
}

test("canonicalUrl quita el source de Medium y de sus dominios propios", () => {
  assert.equal(
    canonicalUrl("https://medium.com/@alguien/rust?source=rss----abc---4"),
    "https://medium.com/@alguien/rust",
  );
  assert.equal(
    canonicalUrl("https://towardsdatascience.com/articulo?source=rss----abc---4"),
    "https://towardsdatascience.com/articulo",
  );
  assert.equal(
    canonicalUrl("https://netflixtechblog.com/articulo?source=rss----abc---4"),
    "https://netflixtechblog.com/articulo",
  );
  assert.equal(
    canonicalUrl("https://publicacion.medium.com/articulo?source=rss----abc---4"),
    "https://publicacion.medium.com/articulo",
  );
});

test("canonicalUrl no toca source fuera de Medium ni el resto de parámetros", () => {
  assert.equal(
    canonicalUrl("https://example.com/articulo?source=newsletter"),
    "https://example.com/articulo?source=newsletter",
  );
  // Dentro de Medium solo se va `source`: el resto de parámetros identifica el artículo.
  assert.equal(
    canonicalUrl("https://medium.com/@alguien/rust?source=rss----abc---4&id=7"),
    "https://medium.com/@alguien/rust?id=7",
  );
});

test("loadRecentLecturaUrls recoge solo las lecturas de la ventana", () => {
  const dir = mkdtempSync(join(tmpdir(), "lecturas-lookback-"));
  writeFileSync(
    join(dir, "2026-10-23.json"),
    JSON.stringify({ lecturas: [{ url: "https://medium.com/ayer", title: "x", source: "s", summary: "y", tema: "ia" }] }),
  );
  writeFileSync(
    join(dir, "2026-10-10.json"),
    JSON.stringify({ lecturas: [{ url: "https://medium.com/hace-dos-semanas", title: "x", source: "s", summary: "y", tema: "ia" }] }),
  );
  // Fuera de la ventana de 30 días (el 30º día previo es 2026-09-24).
  writeFileSync(
    join(dir, "2026-09-01.json"),
    JSON.stringify({ lecturas: [{ url: "https://medium.com/vieja", title: "x", source: "s", summary: "y", tema: "ia" }] }),
  );
  // Sin lecturas y JSON corrupto: no deben romper la lectura.
  writeFileSync(join(dir, "2026-10-22.json"), JSON.stringify({ items: [] }));
  writeFileSync(join(dir, "2026-10-21.json"), "{roto");

  const urls = loadRecentLecturaUrls(dir, "2026-10-24", 30);
  assert.ok(urls.has("https://medium.com/ayer"));
  assert.ok(urls.has("https://medium.com/hace-dos-semanas"));
  assert.ok(!urls.has("https://medium.com/vieja"), "el día 53 hacia atrás no entra en la ventana");
});

test("excludeRecentLecturas quita las ya publicadas y deja el resto", () => {
  const fresh = excludeRecentLecturas(candidates(), new Set(["https://jvns.ca/depurar"]));
  assert.deepEqual(
    fresh.map((c) => c.url),
    ["https://medium.com/@alguien/rust", "https://martinfowler.com/apis"],
  );
});

test("attachLecturas descarta URL inventada y tema inválido, y toma source de la entrada", async () => {
  const digest = emptyDigest();
  const provider = providerReplying({
    lecturas: [
      {
        url: "https://medium.com/@alguien/rust",
        title: "Rust desde cero",
        summary: "Primera frase. Segunda frase.",
        tema: "programacion",
        // El modelo intenta colar una fuente; debe ignorarse.
        source: "Fuente inventada",
      },
      {
        url: "https://inventada.example/x",
        title: "No existe",
        summary: "Primera frase. Segunda frase.",
        tema: "ia",
      },
      {
        url: "https://jvns.ca/depurar",
        title: "Depurar sin miedo",
        summary: "Primera frase. Segunda frase.",
        tema: "opinion",
      },
      {
        url: "https://jvns.ca/depurar",
        title: "Depurar sin miedo",
        summary: "Primera frase. Segunda frase.",
        tema: "carrera",
      },
      // Una entrada que ni siquiera es un objeto se descarta sin tumbar el resto.
      "basura",
    ],
  });

  await attachLecturas(provider, digest, candidates(), 6);

  assert.ok(digest.lecturas);
  assert.equal(digest.lecturas.length, 2);
  assert.deepEqual(digest.lecturas[0], {
    title: "Rust desde cero",
    url: "https://medium.com/@alguien/rust",
    source: "Medium: Programming",
    summary: "Primera frase. Segunda frase.",
    tema: "programacion",
  });
  assert.equal(digest.lecturas[1].source, "Julia Evans");
  assert.equal(digest.lecturas[1].tema, "carrera");
});

test("attachLecturas recorta título y resumen a los topes del schema", async () => {
  const digest = emptyDigest();
  const provider = providerReplying({
    lecturas: [
      {
        url: "https://medium.com/@alguien/rust",
        title: "T".repeat(250),
        summary: "S".repeat(700),
        tema: "ia",
      },
    ],
  });

  await attachLecturas(provider, digest, candidates(), 6);

  assert.ok(digest.lecturas);
  assert.equal(digest.lecturas[0].title.length, 200);
  assert.equal(digest.lecturas[0].summary.length, 600);
});

test("attachLecturas respeta el número de lecturas pedido", async () => {
  const digest = emptyDigest();
  const provider = providerReplying({
    lecturas: candidates().map((c) => ({
      url: c.url,
      title: c.title,
      summary: "Primera frase. Segunda frase.",
      tema: "web",
    })),
  });

  await attachLecturas(provider, digest, candidates(), 2);

  assert.ok(digest.lecturas);
  assert.equal(digest.lecturas.length, 2);
});

test("si el proveedor falla, attachLecturas no rompe la edición", async () => {
  const digest = emptyDigest();
  const provider: Provider = {
    name: "deepseek",
    generate: async () => {
      throw new TypeError("terminated");
    },
  };

  await attachLecturas(provider, digest, candidates(), 6);

  assert.equal(digest.lecturas, undefined);
});

function digestWithItems(): Digest {
  const items: DigestItem[] = Array.from({ length: 8 }, (_, i) => ({
    rank: i + 1,
    category: "lanzamientos",
    title: `Titular ${i + 1}`,
    summary: "Resumen de dos frases. Segunda frase.",
    why_it_matters: "Por qué importa.",
    url: `https://src.example/n${i + 1}`,
    source: "Fuente",
  }));
  return {
    date: "2026-10-24",
    generated_at: "2026-10-24T05:00:00.000Z",
    provider: "deepseek",
    items,
  };
}

test("el schema acepta un digest con lecturas", () => {
  const digest = digestWithItems();
  const urls = new Set(digest.items.map((it) => it.url));
  digest.lecturas = [
    {
      title: "Rust desde cero",
      url: "https://medium.com/@alguien/rust",
      source: "Medium: Programming",
      summary: "Primera frase. Segunda frase.",
      tema: "programacion",
    },
  ];

  const result = validateDigest(digest, urls);
  assert.ok(result.ok, result.errors.join("; "));
});

test("el schema rechaza una lectura con tema inválido", () => {
  const digest = digestWithItems();
  const urls = new Set(digest.items.map((it) => it.url));
  digest.lecturas = [
    {
      title: "Rust desde cero",
      url: "https://medium.com/@alguien/rust",
      source: "Medium: Programming",
      summary: "Primera frase. Segunda frase.",
      tema: "opinion" as LecturaTema,
    },
  ];

  const result = validateDigest(digest, urls);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("lecturas")));
});

test("la ventana de lookback incluye el día 30 y excluye el 31", () => {
  const dir = mkdtempSync(join(tmpdir(), "lecturas-borde-"));
  writeFileSync(
    join(dir, "2026-09-24.json"),
    JSON.stringify({ lecturas: [{ url: "https://medium.com/dia-30" }] }),
  );
  writeFileSync(
    join(dir, "2026-09-23.json"),
    JSON.stringify({ lecturas: [{ url: "https://medium.com/dia-31" }] }),
  );

  const urls = loadRecentLecturaUrls(dir, "2026-10-24", 30);
  assert.ok(urls.has("https://medium.com/dia-30"), "el día 30 entra en la ventana");
  assert.ok(!urls.has("https://medium.com/dia-31"), "el día 31 queda fuera");
});

test("una lectura de Medium con ?source= se publica y al día siguiente se excluye", async () => {
  const raw = "https://medium.com/@alguien/rust?source=rss----abc---4";
  const candidate: NewsItem = {
    title: "Aprender Rust",
    snippet: "Extracto.",
    url: raw,
    source: "Medium: Programming",
    published_at: PUBLISHED_AT,
  };
  const candidates = normalize([candidate], 10, []);
  assert.equal(candidates[0].url, "https://medium.com/@alguien/rust");

  const digest = emptyDigest();
  const provider = providerReplying({
    lecturas: [
      {
        url: candidates[0].url,
        title: "Rust desde cero",
        summary: "Primera frase. Segunda frase.",
        tema: "programacion",
      },
    ],
  });
  await attachLecturas(provider, digest, candidates, 6);
  assert.equal(digest.lecturas?.[0].url, "https://medium.com/@alguien/rust");

  const dir = mkdtempSync(join(tmpdir(), "lecturas-punta-a-punta-"));
  writeFileSync(join(dir, "2026-10-24.json"), JSON.stringify(digest));
  const recent = loadRecentLecturaUrls(dir, "2026-10-25", 30);
  assert.ok(recent.has("https://medium.com/@alguien/rust"), "queda registrada con la forma canónica");
  assert.deepEqual(excludeRecentLecturas(candidates, recent), [], "al día siguiente no vuelve a entrar");
});

function sourcesConfig(): SourcesConfig {
  return {
    user_agent: "test-agent",
    timeout_ms: 1000,
    window_hours: 24,
    candidate_cap: 120,
    enrich_top: 8,
    enrich_timeout_ms: 1000,
    blocked_domains: [],
    rss: [],
    hackernews: { id: "hn", name: "Hacker News", enabled: false, min_points: 0, queries: [] },
    huggingface_trending: { id: "hf", name: "HF", enabled: false, limit: 1 },
    github_trending: { id: "gh", name: "GitHub", enabled: false, since: "daily", limit: 1, pick: 1 },
  };
}

function feed(name: string, url: string): RssSource {
  return { id: name.toLowerCase(), name, url, enabled: true, fragile: false };
}

function lecturasConfig(feeds: RssSource[], overrides: Partial<LecturasConfig> = {}): LecturasConfig {
  return {
    enabled: true,
    window_hours: 168,
    candidate_cap: 120,
    pick: 6,
    lookback_days: 30,
    feeds,
    ...overrides,
  };
}

function feedXml(items: Array<{ title: string; link: string; pubDate: Date }>): string {
  const entries = items
    .map(
      (it) =>
        `<item><title>${it.title}</title><link>${it.link}</link>` +
        `<pubDate>${it.pubDate.toUTCString()}</pubDate></item>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
    `<title>Feed</title><link>https://feed.example</link><description>d</description>` +
    `${entries}</channel></rss>`;
}

/** Sustituye fetch por una respuesta local por URL; devuelve cómo restaurarlo. */
function stubFetch(handler: (url: string) => Promise<Response>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test("collectLecturas omite un feed que falla y conserva el que responde", async () => {
  const now = new Date();
  const restore = stubFetch(async (url) => {
    if (url === "https://ok.example/feed") {
      return new Response(
        feedXml([{ title: "Válida", link: "https://ok.example/uno", pubDate: now }]),
        { status: 200 },
      );
    }
    return new Response("boom", { status: 500 });
  });
  try {
    const out = await collectLecturas(
      sourcesConfig(),
      lecturasConfig([feed("Rota", "https://rota.example/feed"), feed("Buena", "https://ok.example/feed")]),
    );
    assert.deepEqual(out.map((i) => i.url), ["https://ok.example/uno"]);
    assert.equal(out[0].source, "Buena");
  } finally {
    restore();
  }
});

test("collectLecturas devuelve [] si fallan todos los feeds", async () => {
  const restore = stubFetch(async () => new Response("boom", { status: 500 }));
  try {
    const out = await collectLecturas(
      sourcesConfig(),
      lecturasConfig([feed("A", "https://a.example/feed"), feed("B", "https://b.example/feed")]),
    );
    assert.deepEqual(out, []);
  } finally {
    restore();
  }
});

test("collectLecturas excluye antes del tope: lo ya publicado no gasta el hueco", async () => {
  const now = new Date();
  const older = new Date(now.getTime() - 3600_000);
  const restore = stubFetch(async () =>
    new Response(
      feedXml([
        { title: "Publicada ayer", link: "https://ok.example/publicada", pubDate: now },
        { title: "Fresca", link: "https://ok.example/fresca", pubDate: older },
      ]),
      { status: 200 },
    ),
  );
  try {
    const out = await collectLecturas(
      sourcesConfig(),
      lecturasConfig([feed("Buena", "https://ok.example/feed")], { candidate_cap: 1 }),
      new Set(["https://ok.example/publicada"]),
    );
    assert.deepEqual(out.map((i) => i.url), ["https://ok.example/fresca"]);
  } finally {
    restore();
  }
});

test("roundRobinBySource hace hueco a la fuente de baja frecuencia", () => {
  const many: NewsItem[] = Array.from({ length: 50 }, (_, i) => ({
    title: `Artículo ${i + 1}`,
    snippet: "",
    url: `https://medium.com/articulo-${i + 1}`,
    source: "Medium: Programming",
    published_at: new Date(Date.now() - i * 60_000).toISOString(),
  }));
  const single: NewsItem = {
    title: "Un ensayo",
    snippet: "",
    url: "https://danluu.com/ensayo",
    source: "Dan Luu",
    published_at: new Date(Date.now() - 86_400_000).toISOString(),
  };

  const out = roundRobinBySource([...many, single], 10);
  assert.equal(out.length, 10);
  assert.ok(
    out.some((i) => i.source === "Dan Luu"),
    "la única entrada de la fuente de baja frecuencia entra con cap 10",
  );
});
