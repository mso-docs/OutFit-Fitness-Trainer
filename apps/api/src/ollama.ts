import { z } from "zod";
import {
  allowedVariants,
  validateSessions,
  immutable,
  restrictions,
  type Snapshot,
} from "../../../packages/domain/src/planning";
import { assemble, variant } from "../../../packages/domain/src/catalog";
import type { Session } from "../../../packages/domain/src/schemas";
export interface AIProvider {
  models(): Promise<{
    models: { tag: string; digest?: string }[];
    available: boolean;
  }>;
  propose(
    s: Snapshot,
    model: string,
    fallback: Session[],
    signal?: AbortSignal,
  ): Promise<{
    sessions: Session[];
    source: "ollama" | "fallback";
    modelTag: string | null;
  }>;
}
export function ollamaFetch(url: string, options: RequestInit = {}) {
  const host = new URL(url).hostname;
  const browserOptions: RequestInit & { targetAddressSpace?: "loopback" } =
    typeof window !== "undefined" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host)
      ? { targetAddressSpace: "loopback" }
      : {};
  return fetch(url, { ...browserOptions, ...options });
}
export async function boundedJson(response: Response, maximumBytes = 65536) {
  if (!response.ok) throw new Error("AI_HTTP");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI_BODY");
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error("AI_SIZE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createAI(base: string, timeout: number): AIProvider {
  return {
    async models() {
      try {
        const data = await boundedJson(
          await ollamaFetch(base + "/api/tags", {
            redirect: "error",
            signal: AbortSignal.timeout(Math.min(timeout, 10000)),
          }),
        );
        const tags = z
          .object({
            models: z.array(
              z.object({ name: z.string(), digest: z.string().optional() }),
            ),
          })
          .parse(data);
        return {
          models: tags.models.map((m) => ({ tag: m.name, digest: m.digest })),
          available: true,
        };
      } catch {
        return { models: [], available: false };
      }
    },
    async propose(s, model, fallback, signal) {
      const deadline = Date.now() + 90000;
      const safe = {
        sessions: fallback,
        source: "fallback" as const,
        modelTag: null,
      };
      if (!model) return safe;
      const status = await this.models();
      if (!status.models.some((m) => m.tag === model)) return safe;
      const thinking = await thinkingOptions(base, timeout, model, signal);
      const ids = [
        ...new Set(
          fallback.flatMap((x) => allowedVariants(s, x.date).map((v) => v.id)),
        ),
      ];
      const schema = z.strictObject({
        selections: z
          .array(
            z.strictObject({
              date: z.enum(
                fallback.map((x) => x.date) as [string, ...string[]],
              ),
              variantId: z.enum(ids as [string, ...string[]]),
            }),
          )
          .length(7),
        explanation: z.string().max(400),
      });
      const format = z.toJSONSchema(schema);
      const r = restrictions(s);
      const snapshot = {
        goal: s.goal.kind,
        experience: s.profile.experience,
        preferences: s.profile.preferences,
        baselineWeeklyMinutes: s.profile.baselineWeeklyMinutes,
        weeklyCeiling: r.weekly,
        remainingCeiling: r.remaining,
        maximumSessions: r.maxSessions,
        recoveryLow: r.low,
        days: fallback.map((x) => ({
          date: x.date,
          allowedVariantIds: allowedVariants(s, x.date).map((v) => v.id),
          immutable:
            s.current?.sessions.some(
              (o) => o.date === x.date && immutable(s, o),
            ) ?? false,
        })),
        validExample: fallback.map((x) => ({
          date: x.date,
          variantId: x.catalogVariantId ?? "rest",
        })),
      };
      let repair = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await boundedJson(
            await ollamaFetch(base + "/api/chat", {
              method: "POST",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.any([
                AbortSignal.timeout(
                  Math.max(1, Math.min(timeout, deadline - Date.now())),
                ),
                ...(signal ? [signal] : []),
              ]),
              body: JSON.stringify({
                model,
                ...thinking,
                stream: false,
                format,
                options: { temperature: 0, num_predict: 1200, num_ctx: 4096 },
                messages: [
                  {
                    role: "system",
                    content:
                      "Select only permitted catalog variants for seven ordered dates. Respect budgets, rest days and spacing. No medical assessment or instructions. Use the valid example if uncertain. Return the requested JSON only.",
                  },
                  { role: "user", content: JSON.stringify(snapshot) + repair },
                ],
              }),
            }),
          );
          const envelope = z
            .object({
              done: z.literal(true),
              done_reason: z.string().optional(),
              message: z.object({ content: z.string().max(12000) }),
            })
            .parse(response);
          if (envelope.done_reason === "length")
            throw new Error("AI_TRUNCATED");
          const proposal = schema.parse(JSON.parse(envelope.message.content));
          const sessions = proposal.selections.map((x) => {
            const old = s.current?.sessions.find((o) => o.date === x.date);
            return old && immutable(s, old)
              ? x.variantId === (old.catalogVariantId ?? "rest")
                ? old
                : assemble(
                    x.date,
                    variant(x.variantId)!,
                    crypto.randomUUID(),
                    s.profile.outdoorPreferred,
                  )
              : assemble(
                  x.date,
                  variant(x.variantId)!,
                  crypto.randomUUID(),
                  s.profile.outdoorPreferred,
                );
          });
          const errors = validateSessions(s, sessions);
          if (errors.length) {
            repair = "\nCorrect these validation codes: " + errors.join(",");
            continue;
          }
          // Explanations are deliberately fixed in this prototype; unconstrained prose never prescribes activity.
          return { sessions, source: "ollama", modelTag: model };
        } catch (e) {
          if (
            e instanceof Error &&
            (e.name === "TimeoutError" ||
              e.name === "AbortError" ||
              e instanceof TypeError)
          )
            return safe;
          repair =
            "\nPrevious proposal failed STRUCTURE validation. Return the valid example.";
        }
        if (Date.now() >= deadline) break;
      }
      return safe;
    },
  };
}

export async function thinkingOptions(
  base: string,
  timeout: number,
  model: string,
  signal?: AbortSignal,
): Promise<{ think?: false }> {
  let disableThinking = false;
  try {
    const details = await boundedJson(
      await ollamaFetch(base + "/api/show", {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.min(timeout, 10000)),
          ...(signal ? [signal] : []),
        ]),
      }),
      262144,
    );
    const controls = z
      .object({
        capabilities: z.array(z.string()).optional(),
        thinking: z
          .object({ values: z.array(z.union([z.boolean(), z.string()])) })
          .optional(),
      })
      .parse(details);
    disableThinking =
      controls.thinking?.values.includes(false) ??
      (controls.capabilities?.includes("thinking") === true &&
        /^qwen3\.8(?::|$)/.test(model));
  } catch {
    // Missing discovery metadata keeps the provider's default behavior.
  }

  return disableThinking ? { think: false } : {};
}
