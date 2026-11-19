import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Component tests that need a real browser: anything that depends on layout
 * (text measurement, kerning, overflow), which a fake DOM reports as all zeros.
 * Plain logic stays on `node --test` (`pnpm test:unit`); this is only for
 * `*.browser.test.tsx`, colocated with the component.
 *
 * Not `vite.config.ts`: the React Router plugin there expects to build the app,
 * not a test page. Tailwind is kept so the components render with their real
 * classes and the bundled Geist font.
 */
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["app/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      // Same Chromium the e2e suite installs (`playwright install chromium`).
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
