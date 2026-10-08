import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function onboard(page: Page) {
  await page.goto("./");
  await page.getByLabel("I am 18 or older.").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Save my profile", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A little outside goes a long way." }),
  ).toBeVisible();
}
test("static Pages edition persists data and handles fallback, imports, export and deletion without OutFit API", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1"))
      apiRequests.push(r.url());
  });
  await onboard(page);
  await page.getByRole("button", { name: "My plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Create my plan", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Fallback planner", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Ollama address")).toHaveValue(
    "http://127.0.0.1:11434",
  );
  await page.getByLabel("Height (cm)", { exact: true }).fill("175");
  await page.getByRole("button", { name: "Save measurements" }).click();
  await expect(
    page.getByText("Measurements saved.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Height (cm)", { exact: true })).toHaveValue(
    "175",
  );
  await page.getByRole("button", { name: "Health data", exact: true }).click();
  await page.getByLabel("Activity JSON file").setInputFiles({
    name: "activity.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        activities: [
          {
            source: "strava",
            externalId: "example",
            startedAt: "2026-10-08T12:00:00Z",
            endedAt: "2026-10-08T12:10:00Z",
            sourceTimezone: "UTC",
            activity: "walk",
            durationSeconds: 600,
            distanceMeters: 800,
            modifiedAt: "2026-10-08T12:10:00Z",
            deleted: false,
          },
        ],
      }),
    ),
  });
  await expect(
    page.getByText("1 records · 10 min", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toBe("outfit-export.json");
  await page.getByRole("button", { name: "Delete local data" }).click();
  await page
    .getByLabel("Type DELETE_MY_DATA to confirm")
    .fill("DELETE_MY_DATA");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete local data" })
    .click();
  await expect(page.getByLabel("I am 18 or older.")).toBeVisible();
  expect(apiRequests).toEqual([]);
});
test("browser uses direct Ollama for validated planning and Markdown trainer chat", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:11434/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-private-network": "true",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path === "/api/tags")
      return route.fulfill({
        headers,
        json: { models: [{ name: "test:local", digest: "synthetic" }] },
      });
    if (path === "/api/show")
      return route.fulfill({ headers, json: { capabilities: ["completion"] } });
    const input = route.request().postDataJSON();
    const content = input.format
      ? JSON.stringify({
          selections: JSON.parse(input.messages[1].content).validExample,
          explanation: "A gentle week.",
        })
      : "**Small steps** build *steady habits*.";
    return route.fulfill({
      headers,
      json: { done: true, done_reason: "stop", message: { content } },
    });
  });
  await onboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Locally installed model").selectOption("test:local");
  await page.getByRole("button", { name: "My plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Create my plan", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Local AI plan", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Accept this plan" }).click();
  await page.getByRole("button", { name: "Trainer", exact: true }).click();
  await page
    .getByLabel("Your question", { exact: true })
    .fill("How can I build a habit?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".chat-markdown strong")).toHaveText("Small steps");
  await expect(page.locator(".chat-markdown em")).toHaveText("steady habits");
});
