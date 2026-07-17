// Helpers HTTP con timeout y User-Agent identificable. Usa el fetch global de Node.

async function request(
  url: string,
  timeoutMs: number,
  userAgent: string,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: accept },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<string> {
  const res = await request(url, timeoutMs, userAgent, "application/rss+xml, application/xml, text/xml, */*");
  return res.text();
}

export async function fetchJson<T = unknown>(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<T> {
  const res = await request(url, timeoutMs, userAgent, "application/json");
  return res.json() as Promise<T>;
}
