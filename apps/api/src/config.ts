import { z } from "zod";
export interface Config {
  host: string;
  port: number;
  database: string;
  ollamaURL: string;
  model: string;
  timeout: number;
  origin: string;
  accessToken: string | null;
  devOrigin: string | null;
}
const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.APP_HOST ?? "127.0.0.1";
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(env.APP_PORT ?? 3001);
  const url = new URL(env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
  if (
    (!loopback(url.hostname) && env.OLLAMA_ALLOW_REMOTE !== "true") ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Ollama requires a loopback HTTP(S) origin, or OLLAMA_ALLOW_REMOTE=true for a trusted remote origin; credentials, paths, and queries are forbidden.",
    );
  const accessToken = env.APP_ACCESS_TOKEN ?? null;
  if (!loopback(host) && (!accessToken || accessToken.length < 32))
    throw new Error(
      "Non-loopback hosting requires APP_ACCESS_TOKEN with at least 32 characters.",
    );
  if (
    env.APP_DEV_ORIGIN &&
    new URL(env.APP_DEV_ORIGIN).origin !== env.APP_DEV_ORIGIN
  )
    throw new Error("APP_DEV_ORIGIN must be an origin.");
  const origin =
    env.APP_ORIGIN ??
    `http://${host.includes(":") ? "[" + host + "]" : host}:${port}`;
  if (new URL(origin).origin !== origin)
    throw new Error("APP_ORIGIN must be an origin.");
  return {
    host,
    port,
    database: env.DATABASE_PATH ?? "./data/outfit.db",
    ollamaURL: url.origin,
    model: env.OLLAMA_MODEL ?? "",
    timeout: z.coerce
      .number()
      .int()
      .min(100)
      .max(60000)
      .parse(env.OLLAMA_TIMEOUT_MS ?? 60000),
    origin,
    accessToken,
    devOrigin: env.APP_DEV_ORIGIN ?? null,
  };
}
