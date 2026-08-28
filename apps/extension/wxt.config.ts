import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Substratum",
    description: "Right-click any image to save it to your Substratum library.",
    // Minimal by design: no <all_urls>, no content scripts. The
    // server fetches the image bytes, so this extension only ever talks to the
    // user's own instance — whose origin is granted at runtime when they pair
    // it on the options page.
    permissions: ["contextMenus", "notifications", "storage"],
    optional_host_permissions: ["*://*/*"],
    // Required for the badge — without an `action` key the browser.action API
    // doesn't exist, and the ✓/! success signal silently does nothing.
    action: {
      default_title: "Substratum",
    },
  },
});
