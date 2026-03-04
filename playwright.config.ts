import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node packages/server/dist/serve.js",
      port: 30588,
      reuseExistingServer: !process.env.CI,
      env: { PORT: "30588" },
    },
    {
      command: "pnpm --filter @imposter-zero/web exec vite --port 5173",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
