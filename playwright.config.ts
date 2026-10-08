import { defineConfig } from "@playwright/test";
const server = (name: string, port: number) => ({
  command: `APP_HOST=127.0.0.1 APP_PORT=${port} APP_ORIGIN=http://127.0.0.1:${port} APP_ACCESS_TOKEN= DATABASE_PATH=/tmp/outfit-e2e-${name}.db OLLAMA_MODEL= OLLAMA_BASE_URL=http://127.0.0.1:11435 npm start`,
  url: `http://127.0.0.1:${port}/api/v1/health`,
  reuseExistingServer: false,
  timeout: 30000,
});
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/server",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4301",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        baseURL: "http://127.0.0.1:4302",
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [server("desktop", 4301), server("mobile", 4302)],
});
