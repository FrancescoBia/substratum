import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Unit tests live next to the module they cover, and `pnpm test:unit` runs
 * both projects:
 *
 * - `unit`: plain logic in Node (`*.test.ts`). Some of it shells out to the
 *   real ffmpeg/ffprobe, so those need to be on PATH.
 * - `browser`: components that depend on real layout (text measurement,
 *   kerning, overflow), which a fake DOM reports as all zeros
 *   (`*.browser.test.tsx`). Runs in headless Chromium, the same build the e2e
 *   suite installs with `playwright install chromium`.
 *
 * Not `vite.config.ts`: the React Router plugin there expects to build the app,
 * not a test page.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["app/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        // Tailwind is kept so the components render with their real classes
        // and the bundled Geist font.
        plugins: [tailwindcss()],
        test: {
          name: "browser",
          include: ["app/**/*.browser.test.tsx"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
