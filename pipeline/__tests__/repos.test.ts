import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  excludeRecentRepos,
  loadRecentRepoNames,
  previousEditionDates,
  REPO_LOOKBACK_DAYS,
} from "../curate/repos.ts";
import type { RepoRaw } from "../types.ts";

test("previousEditionDates lista los N días previos sin incluir la fecha", () => {
  assert.deepEqual(previousEditionDates("2026-07-22", 3), [
    "2026-07-21",
    "2026-07-20",
    "2026-07-19",
  ]);
  assert.equal(previousEditionDates("2026-07-22", REPO_LOOKBACK_DAYS).length, 7);
  assert.equal(previousEditionDates("2026-03-01", 1)[0], "2026-02-28");
});

test("loadRecentRepoNames recoge repos de las ediciones en la ventana", () => {
  const dir = mkdtempSync(join(tmpdir(), "repos-lookback-"));
  writeFileSync(
    join(dir, "2026-07-21.json"),
    JSON.stringify({ repos: [{ name: "acme/ayer", url: "https://github.com/acme/ayer", description: "x" }] }),
  );
  writeFileSync(
    join(dir, "2026-07-16.json"),
    JSON.stringify({ repos: [{ name: "acme/hace-seis", url: "https://github.com/acme/hace-seis", description: "x" }] }),
  );
  // Fuera de la ventana de 7 días (2026-07-15 sería el 7º día previo; 14 queda fuera).
  writeFileSync(
    join(dir, "2026-07-14.json"),
    JSON.stringify({ repos: [{ name: "acme/viejo", url: "https://github.com/acme/viejo", description: "x" }] }),
  );
  // Sin repos / ausente: no debe fallar.
  writeFileSync(join(dir, "2026-07-20.json"), JSON.stringify({ items: [] }));

  const names = loadRecentRepoNames(dir, "2026-07-22", 7);
  assert.ok(names.has("acme/ayer"));
  assert.ok(names.has("acme/hace-seis"));
  assert.ok(!names.has("acme/viejo"), "el día 8 hacia atrás no entra en la ventana");
});

test("excludeRecentRepos quita los ya publicados y deja el resto", () => {
  const trending: RepoRaw[] = [
    { name: "nuevo/a", url: "https://github.com/nuevo/a", description: "", language: "", stars: 1, stars_today: 1 },
    { name: "acme/ayer", url: "https://github.com/acme/ayer", description: "", language: "", stars: 1, stars_today: 1 },
    { name: "nuevo/b", url: "https://github.com/nuevo/b", description: "", language: "", stars: 1, stars_today: 1 },
  ];
  const fresh = excludeRecentRepos(trending, new Set(["acme/ayer"]));
  assert.deepEqual(
    fresh.map((r) => r.name),
    ["nuevo/a", "nuevo/b"],
  );
});
