import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: ["pages/*.spec.ts", "e2e/core.spec.ts"],
  grepInvert: /trainer replies render Markdown/,
  outputDir: "test-results/pages",
  workers: 1,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4173/OutFit/", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "python3 scripts/serve-pages-test.py",
    url: "http://127.0.0.1:4173/OutFit/",
    reuseExistingServer: false,
  },
});
