import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "../apps/api/src/config";
import { createAI } from "../apps/api/src/ollama";
import { snapshot, profile } from "../tests/fixtures/domain";
import {
  fallback,
  today,
  validateSessions,
} from "../packages/domain/src/planning";
if (existsSync(".env")) process.loadEnvFile(".env");
const c = config();
if (!c.model) {
  console.error(
    "Set OLLAMA_MODEL to an installed local tag before running this smoke test.",
  );
  process.exit(1);
}
const ai = createAI(c.ollamaURL, c.timeout);
const status = await ai.models();
const installed = status.models.find((m) => m.tag === c.model);
if (!installed) {
  console.error("Ollama or the selected local model is unavailable.");
  process.exit(1);
}
const date = today("America/New_York");
const fixture = snapshot({
  profile: profile({
    availability: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      maxMinutes: 20,
    })),
  }),
  startDate: date,
  date,
});
const started = performance.now();
const result = await ai.propose(
  fixture,
  c.model,
  fallback(fixture, randomUUID),
);
if (
  result.source !== "ollama" ||
  validateSessions(fixture, result.sessions).length
) {
  console.error(
    "Real generation did not pass validation; the fallback remains available.",
  );
  process.exit(1);
}
const version = (await fetch(c.ollamaURL + "/api/version", {
  signal: AbortSignal.timeout(2000),
  redirect: "error",
}).then((r) => r.json())) as { version?: string };
console.log(
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      node: process.version,
      ollama: version.version ?? "unknown",
      modelTag: c.model,
      modelDigest: installed.digest ?? null,
      durationMs: Math.round(performance.now() - started),
      source: result.source,
      days: result.sessions.length,
      promptVersion: "outfit-1",
      policyVersion: "outfit-1",
    },
    null,
    2,
  ),
);
