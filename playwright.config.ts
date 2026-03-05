import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "mobile-landscape",
      use: {
        browserName: "chromium",
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-portrait",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet-landscape",
      use: {
        browserName: "chromium",
        viewport: { width: 1180, height: 820 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: "node packages/server/dist/serve.js",
      port: 30590,
      reuseExistingServer: !process.env.CI,
      env: { PORT: "30590" },
    },
    {
      command: "pnpm --filter @imposter-zero/web exec vite --port 5174",
      port: 5174,
      reuseExistingServer: !process.env.CI,
      env: { WS_URL: "ws://localhost:30590" },
    },
  ],
});
