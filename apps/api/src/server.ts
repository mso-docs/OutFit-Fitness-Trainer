import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app";
import { config } from "./config";
import fastifyStatic from "@fastify/static";
if (existsSync(".env")) process.loadEnvFile(".env");
const c = config();
const { app } = buildApp(c);
const web = resolve("dist/web");
if (existsSync(web)) {
  await app.register(fastifyStatic, { root: web });
}
await app.listen({ host: c.host, port: c.port });
console.log(`OutFit is available at ${c.origin}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
