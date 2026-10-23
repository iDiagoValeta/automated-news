import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGithubTrending,
  combineTrendingResult,
  flagTrendingParseAlert,
  parseTrending,
  trendingParseLooksBroken,
} from "../sources/github.ts";
import type { GithubTrendingConfig, RepoRaw, SourcesConfig } from "../types.ts";

const html = readFileSync(fileURLToPath(new URL("./fixtures/github-trending.html", import.meta.url)), "utf8");

test("parseTrending extrae nombre, url, descripción, lenguaje y estrellas", () => {
  const repos = parseTrending(html, 25);
  assert.equal(repos.length, 2);

  const [a, b] = repos;
  assert.equal(a.name, "acme/agente-ia");
  assert.equal(a.url, "https://github.com/acme/agente-ia");
  assert.equal(a.description, "An open-source AI agent framework for building tools.");
  assert.equal(a.language, "Python");
  assert.equal(a.stars, 12532);
  assert.equal(a.stars_today, 827);

  // El segundo no tiene lenguaje ni estrellas del día: deben quedar en vacío/0.
  assert.equal(b.name, "foo/mini-tool");
  assert.equal(b.language, "");
  assert.equal(b.stars, 340);
  assert.equal(b.stars_today, 0);
});

test("parseTrending respeta el límite", () => {
  const repos = parseTrending(html, 1);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].name, "acme/agente-ia");
});

test("parseTrending sobre snapshot real de github.com/trending extrae suficientes repos", () => {
  const snapshot = readFileSync(
    fileURLToPath(new URL("./fixtures/github-trending.snapshot.html", import.meta.url)),
    "utf8",
  );
  const repos = parseTrending(snapshot, 25);
  assert.ok(repos.length >= 5, `esperaba ≥5 repos, obtuve ${repos.length}`);
  for (const r of repos) {
    assert.match(r.name, /^[^/]+\/[^/]+$/);
    assert.equal(r.url, `https://github.com/${r.name}`);
    assert.equal(typeof r.description, "string");
    assert.ok(r.stars >= 0);
  }
});

test("trendingParseLooksBroken avisa por debajo del umbral", () => {
  assert.equal(trendingParseLooksBroken(0), true);
  assert.equal(trendingParseLooksBroken(4), true);
  assert.equal(trendingParseLooksBroken(5), false);
  assert.equal(trendingParseLooksBroken(17), false);
});

function repo(name: string): RepoRaw {
  return { name, url: `https://github.com/${name}`, description: "", language: "", stars: 1, stars_today: 1 };
}

test("combineTrendingResult combina scraping y API, deduplica por nombre y respeta el límite", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];
  // La API repite scraping/uno: no debe entrar dos veces.
  const fallback = [repo("scraping/uno"), repo("api/uno"), repo("api/dos")];
  let calls = 0;

  const choice = await combineTrendingResult(parsed, 5, 3, async () => {
    calls++;
    return fallback;
  });

  assert.equal(calls, 1);
  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["scraping/uno", "scraping/dos", "api/uno"],
  );
  assert.equal(choice.parsedCount, 2);
  assert.equal(choice.apiCount, 1);
});

test("combineTrendingResult mantiene los parciales si el fallback falla", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];

  const choice = await combineTrendingResult(parsed, 5, 5, async () => {
    throw new Error("Search API HTTP 403");
  });

  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["scraping/uno", "scraping/dos"],
  );
  assert.equal(choice.parsedCount, 2);
  assert.equal(choice.apiCount, 0);
});

test("combineTrendingResult añade el fallback aunque dé menos repos que el scraping", async () => {
  const parsed = [repo("scraping/uno"), repo("scraping/dos")];

  const choice = await combineTrendingResult(parsed, 5, 5, async () => [repo("api/uno")]);

  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["scraping/uno", "scraping/dos", "api/uno"],
  );
  assert.equal(choice.parsedCount, 2);
  assert.equal(choice.apiCount, 1);
});

test("combineTrendingResult no llama al fallback si el parseo es sano", async () => {
  const parsed = [repo("a/uno"), repo("a/dos"), repo("a/tres"), repo("a/cuatro"), repo("a/cinco")];
  let calls = 0;

  const choice = await combineTrendingResult(parsed, 5, 5, async () => {
    calls++;
    return [repo("api/uno")];
  });

  assert.equal(calls, 0);
  assert.equal(choice.repos, parsed);
  assert.equal(choice.apiCount, 0);
});

test("combineTrendingResult usa el fallback cuando el scraping no devuelve repos", async () => {
  const choice = await combineTrendingResult([], 5, 5, async () => [repo("api/uno")]);

  assert.deepEqual(
    choice.repos.map((r) => r.name),
    ["api/uno"],
  );
  assert.equal(choice.parsedCount, 0);
  assert.equal(choice.apiCount, 1);
});

test("combineTrendingResult devuelve vacío si no hay scraping ni fallback", async () => {
  const choice = await combineTrendingResult([], 5, 5, async () => {
    throw new Error("Search API HTTP 500");
  });

  assert.deepEqual(choice.repos, []);
  assert.equal(choice.parsedCount, 0);
  assert.equal(choice.apiCount, 0);
});

test("flagTrendingParseAlert escribe GITHUB_OUTPUT cuando existe", () => {
  const dir = mkdtempSync(join(tmpdir(), "trending-alert-"));
  const out = join(dir, "github-output");
  appendFileSync(out, "");
  const prev = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = out;
  try {
    flagTrendingParseAlert();
    const body = readFileSync(out, "utf8");
    assert.match(body, /trending_parse_alert=true/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = prev;
  }
});

// ---- Flujo completo de collectGithubTrending, sin red real ----

const trendingSnapshotHtml = readFileSync(
  fileURLToPath(new URL("./fixtures/github-trending.snapshot.html", import.meta.url)),
  "utf8",
);

// Primeros dos <article class="Box-row"> con repo del snapshot: parseo parcial
// (2 < umbral 5). El comentario inicial del fixture contiene la misma cadena,
// así que se descartan los bloques sin <h2> antes de recortar.
function partialTrendingHtml(): string {
  const blocks = trendingSnapshotHtml
    .split('<article class="Box-row">')
    .slice(1)
    .map((b) => b.slice(0, b.indexOf("</article>")))
    .filter((b) => /<h2[^>]*>[\s\S]*?href="\//.test(b))
    .slice(0, 2);
  return blocks.map((b) => `<article class="Box-row">${b}</article>`).join("\n");
}

// El flujo solo usa user_agent y timeout_ms; el resto de SourcesConfig no aplica.
const sourcesCfg = { user_agent: "test-agent", timeout_ms: 1000 } as SourcesConfig;
const githubCfg: GithubTrendingConfig = {
  id: "github_trending",
  name: "GitHub Trending",
  enabled: true,
  since: "daily",
  limit: 10,
  pick: 3,
  min_parse_alert: 5,
};

function searchItems(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    full_name: `api/repo-${i + 1}`,
    html_url: `https://github.com/api/repo-${i + 1}`,
    description: `Repositorio de prueba ${i + 1}`,
    language: "TypeScript",
    stargazers_count: 1000 - i,
  }));
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchStub {
  calls: string[];
  restore: () => void;
}

// Sustituye el fetch global solo durante el test; restore() lo devuelve al original.
function stubFetch(respond: (url: string) => Response): FetchStub {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

// Prepara un GITHUB_OUTPUT temporal, ejecuta el flujo y devuelve lo escrito.
async function withGithubOutput(run: () => Promise<void>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "trending-flow-"));
  const out = join(dir, "github-output");
  appendFileSync(out, "");
  const prev = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = out;
  try {
    await run();
    return readFileSync(out, "utf8");
  } finally {
    if (prev === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = prev;
  }
}

test("collectGithubTrending combina scraping y API sin duplicados y sin alerta", async () => {
  // La API repite un repo del scraping: debe descartarse y dejar hueco a otro.
  const duplicated = {
    full_name: "cloudflare/security-audit-skill",
    html_url: "https://github.com/cloudflare/security-audit-skill",
    description: "Duplicado del scraping",
    language: "TypeScript",
    stargazers_count: 2000,
  };
  const stub = stubFetch((url) => {
    if (url.includes("github.com/trending")) return htmlResponse(partialTrendingHtml());
    if (url.includes("api.github.com/search/repositories")) {
      return jsonResponse({ items: [duplicated, ...searchItems(9)] });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  try {
    const body = await withGithubOutput(async () => {
      const repos = await collectGithubTrending(sourcesCfg, githubCfg);
      const names = repos.map((r) => r.name);
      assert.equal(repos.length, 10);
      assert.deepEqual(names, [
        "cloudflare/security-audit-skill",
        "anthropics/claude-code",
        ...Array.from({ length: 8 }, (_, i) => `api/repo-${i + 1}`),
      ]);
      assert.equal(new Set(names).size, names.length);
      // La Search API no da estrellas del periodo.
      assert.equal(repos[9].stars_today, 0);
    });

    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[0], /github\.com\/trending/);
    assert.match(stub.calls[1], /api\.github\.com\/search\/repositories/);
    assert.doesNotMatch(body, /trending_parse_alert=true/);
  } finally {
    stub.restore();
  }
});

test("collectGithubTrending alerta si la Search API falla y quedan los parciales", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("github.com/trending")) return htmlResponse(partialTrendingHtml());
    if (url.includes("api.github.com/search/repositories")) {
      return jsonResponse({ message: "boom" }, 500);
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  try {
    const body = await withGithubOutput(async () => {
      const repos = await collectGithubTrending(sourcesCfg, githubCfg);
      assert.equal(repos.length, 2);
      assert.deepEqual(
        repos.map((r) => r.name),
        ["cloudflare/security-audit-skill", "anthropics/claude-code"],
      );
    });

    assert.equal(stub.calls.length, 2);
    assert.match(body, /trending_parse_alert=true/);
  } finally {
    stub.restore();
  }
});

test("collectGithubTrending no llama a la Search API ni alerta con un scraping sano", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("github.com/trending")) return htmlResponse(trendingSnapshotHtml);
    throw new Error(`llamada inesperada a ${url}`);
  });
  try {
    const body = await withGithubOutput(async () => {
      const repos = await collectGithubTrending(sourcesCfg, githubCfg);
      assert.ok(repos.length >= 5, `esperaba ≥5 repos, obtuve ${repos.length}`);
    });

    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0], /github\.com\/trending/);
    assert.doesNotMatch(body, /trending_parse_alert=true/);
  } finally {
    stub.restore();
  }
});

test("collectGithubTrending alerta si el HTML 200 no parsea ningún repo aunque la API rescate", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("github.com/trending")) return htmlResponse("<html><body>markup nuevo</body></html>");
    if (url.includes("api.github.com/search/repositories")) {
      return jsonResponse({ items: searchItems(10) });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  try {
    const body = await withGithubOutput(async () => {
      const repos = await collectGithubTrending(sourcesCfg, githubCfg);
      assert.equal(repos.length, 10);
      assert.equal(repos[0].name, "api/repo-1");
    });

    assert.equal(stub.calls.length, 2);
    // 0 repos de un HTML 200 es markup roto, no un día flojo: se avisa siempre.
    assert.match(body, /trending_parse_alert=true/);
  } finally {
    stub.restore();
  }
});

test("collectGithubTrending sin alerta si el scraping cae y la Search API devuelve repos", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("github.com/trending")) throw new Error("ECONNRESET");
    if (url.includes("api.github.com/search/repositories")) {
      return jsonResponse({ items: searchItems(10) });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  try {
    const body = await withGithubOutput(async () => {
      const repos = await collectGithubTrending(sourcesCfg, githubCfg);
      assert.equal(repos.length, 10);
      assert.equal(repos[0].name, "api/repo-1");
    });

    assert.equal(stub.calls.length, 2);
    // Un fallo de red no dice nada del parser: no hay alerta de parseo.
    assert.doesNotMatch(body, /trending_parse_alert=true/);
  } finally {
    stub.restore();
  }
});

