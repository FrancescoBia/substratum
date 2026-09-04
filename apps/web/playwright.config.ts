import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against a throwaway instance on its own port and data directory, so a
 * test run can never touch a real one. `pnpm test:e2e` wipes that directory
 * first — the reset is a separate step rather than a hook so ordering against
 * the web server is never in question.
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one instance, one database — parallel writes would interfere
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    // Creates the Owner and saves the session, so no test ever types a password.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SUBSTRATUM_DATA_DIR: ".playwright-data",
      // SUBSTRATUM_URL is deliberately absent: unset is the default a developer
      // actually runs, and it is the path that used to hand out links to
      // whatever else was listening on port 3000. Leaving it off puts every
      // public-board spec on the origin derived from the request.

      // Sweep often so the purge test can observe a real one. Retention stays
      // at its 30-day default — the test backdates a row rather than shortening
      // the window, so it exercises the same arithmetic production uses.
      SUBSTRATUM_TRASH_PURGE_INTERVAL_MS: "1000",
    },
  },
});
