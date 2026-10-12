import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  // React Router's dev server loads this directory's .env files into
  // process.env for server code, ahead of anything in the app. The e2e server
  // sets SUBSTRATUM_SKIP_ENV_FILE so the suite runs on the defaults it was
  // written for rather than on a developer's own .env; `false` turns the
  // loading off.
  envDir: process.env.SUBSTRATUM_SKIP_ENV_FILE ? false : undefined,
});
