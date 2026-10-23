// Helpers HTTP con timeout y User-Agent identificable. Usa el fetch global de Node.

/**
 * Ejecuta la petición y consume el cuerpo dentro de la misma ventana de timeout.
 * Si el servidor manda cabeceras y luego gotea o no cierra el cuerpo, el abort
 * corta también `text()`/`json()`; si no, una sola fuente colgaría la edición
 * entera (issue #43).
 */
export async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number,
  init: RequestInit,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await read(res);
  } catch (e) {
    // Distingue el timeout de un error de red o de parseo del propio cuerpo.
    if (controller.signal.aborted) {
      throw new Error(`Timeout de ${timeoutMs} ms en ${url}`, { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<string> {
  return fetchWithTimeout(
    url,
    timeoutMs,
    {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
    },
    (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      return res.text();
    },
  );
}

export async function fetchJson<T = unknown>(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<T> {
  return fetchWithTimeout(
    url,
    timeoutMs,
    { headers: { "User-Agent": userAgent, Accept: "application/json" }, redirect: "follow" },
    (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      return res.json() as Promise<T>;
    },
  );
}
