// Logger mínimo. Escribe a stderr para dejar stdout libre.

type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: unknown): void {
  const time = new Date().toISOString();
  const line = `[${time}] ${level.toUpperCase()} ${msg}`;
  if (meta !== undefined) console.error(line, meta);
  else console.error(line);
}

export function log(msg: string, meta?: unknown): void {
  emit("info", msg, meta);
}

export function warn(msg: string, meta?: unknown): void {
  emit("warn", msg, meta);
}

export function error(msg: string, meta?: unknown): void {
  emit("error", msg, meta);
}
