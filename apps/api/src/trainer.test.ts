import { it, expect, vi, afterEach } from "vitest";
import { createTrainer } from "./trainer";
afterEach(() => vi.unstubAllGlobals());
it("returns plain-text AI coaching with policy and minimal context", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags"))
        return Response.json({ models: [{ name: "test:local" }] });
      if (url.endsWith("/api/show"))
        return Response.json({ thinking: { values: [false, true] } });
      calls.push(init!);
      return Response.json({
        done: true,
        message: { content: "Start with the easy walk in your saved plan." },
      });
    }),
  );
  const reply = await createTrainer("http://127.0.0.1:11434", 1000)(
    [{ role: "user", content: "Help me get started." }],
    { goal: "walk_more" },
    "test:local",
    new AbortController().signal,
  );
  expect(reply.source).toBe("ollama");
  const body = JSON.parse(calls[0].body as string);
  expect(body.think).toBe(false);
  expect(body.messages[0].content).toContain("Do not prescribe a new workout");
  expect(body.messages[0].content).toContain("walk_more");
});
it.each([
  { done: true, done_reason: "length", message: { content: "unfinished" } },
  { done: true, message: { content: "" } },
])(
  "labels unusable replies as offline instead of AI success",
  async (result) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/api/tags")
            ? { models: [{ name: "test:local" }] }
            : url.endsWith("/api/show")
              ? {}
              : result,
        ),
      ),
    );
    const reply = await createTrainer("http://127.0.0.1:11434", 1000)(
      [{ role: "user", content: "Hello" }],
      {},
      "test:local",
      new AbortController().signal,
    );
    expect(reply.source).toBe("offline");
  },
);
