import editionsFn from "./editions.js";
import site from "./site.js";
import { buildAtom, buildRss, buildRobots, buildSitemap, staticPagePaths } from "../_11ty/feeds.js";
import { buildWeek } from "../_11ty/semana.js";
import { buildSearchIndex } from "../_11ty/search.js";

const editions = editionsFn();
const origin = String(site.url || "").replace(/\/$/, "");

export default {
  rss: buildRss({ site, editions }),
  atom: buildAtom({ site, editions }),
  sitemap: buildSitemap(site.url, staticPagePaths(editions)),
  robots: buildRobots(`${origin}/sitemap.xml`),
  semana: buildWeek(editions, 7),
  searchIndex: JSON.stringify(buildSearchIndex(editions)),
};
