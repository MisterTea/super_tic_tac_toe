import { defineConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true);
const remoteUrl = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  use: {
    baseURL: remoteUrl || "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: remoteUrl
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
      },
  workers: 1,
});
