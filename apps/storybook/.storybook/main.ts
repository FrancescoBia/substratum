import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";

import { imageFixtures } from "./image-fixtures";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  // Stories live next to what they describe; this app only collects them.
  stories: [
    "../../../packages/ui/stories/**/*.stories.@(ts|tsx)",
    "../../web/app/**/*.stories.@(ts|tsx)",
  ],
  core: { disableTelemetry: true },
  viteFinal(config) {
    config.plugins = [...(config.plugins ?? []), tailwindcss(), imageFixtures()];
    config.resolve = {
      ...config.resolve,
      // Resolves web's `~/*` alias, from the tsconfig nearest each importer.
      tsconfigPaths: true,
      // Stories and components resolve these from different workspaces;
      // one copy each, or hooks and router context break across the seam.
      dedupe: ["react", "react-dom", "react-router"],
    };
    return config;
  },
};

export default config;
