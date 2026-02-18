import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.E2E_PORT ?? "3100", 10);
const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "synn-e2e";

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      FIREBASE_PROJECT_ID: projectId,
      GCLOUD_PROJECT: projectId,
      NEXT_PUBLIC_FIREBASE_API_KEY:
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "127.0.0.1",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || projectId,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
      NEXT_PUBLIC_FIREBASE_APP_ID:
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
        "1:1234567890:web:e2e000000000000000000",
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "1",
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: authEmulatorHost,
      NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
      FIREBASE_AUTH_EMULATOR_HOST: authEmulatorHost,
      FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
