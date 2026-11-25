import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // WXT owns the Vite config, so Tailwind is added through this hook rather
  // than a vite.config.ts of our own.
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  // The zip is attached to each GitHub Release, so it's named for whoever
  // downloads it. `packageVersion` keeps a pre-release suffix that the
  // manifest's `version` has to drop.
  zip: {
    artifactTemplate: "substratum-extension-{{packageVersion}}.zip",
  },
  manifest: {
    name: "Substratum",
    description: "Right-click any image or video to save it to your Substratum library.",
    // Minimal by design: no <all_urls>, no content scripts in the manifest. The
    // server fetches the bytes, so this extension only ever talks to the
    // user's own instance — whose origin is granted at runtime when they pair
    // it on the options page. `scripting` carries no install warning; it only
    // registers the opt-in site fixes (lib/sites.ts), each behind its own
    // runtime host permission. Nor does `activeTab`: it's what lets a click on
    // the toolbar icon read which site it was clicked on.
    permissions: ["activeTab", "contextMenus", "notifications", "scripting", "storage"],
    optional_host_permissions: ["*://*/*"],
    // Required for the badge — without an `action` key the browser.action API
    // doesn't exist, and the ✓/! success signal silently does nothing. No
    // popup: a click switches the overlay fix for the current site.
    action: {
      default_title: "Substratum — click to see through overlays on this site",
    },
    // The Chrome Web Store listing's public key. It gives every build, unpacked
    // ones included, the store's ID, which is the only one an instance accepts
    // by default (SUBSTRATUM_EXTENSION_ID). publish-extension.yml strips it
    // before uploading, since the store assigns its own.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs1yshY5iaQYLXF1kRhN30YKSsnzhe+sUPb6eylDIsmnW8rcs0nlIm0EWDlmeUi/jyiy+CUfRteEe0yvjSqWQ3YoAR+3A49IZWci793eoIvBVe0GmDCDX4Kkq6CuO3kTDX6vjzyNM6N72GqLDA7izQIlfJuYfFoMSjREr4W19k1+GQyWDJqZo5PqM2R5T6gAR+Uh9tR1pWQWq41VI6Nuri+c1q07dUvOZ+0nYd7FotJm6Ki3JVmbxLIrT732HeCA+PxcUhvYwH/O26CkUH8xx//rzAxen5+x8wFd9gq62OQjqi7QpW9VtPN/54xaJ7xr2PniLcaCd74pqhY74DeJeLwIDAQAB",
  },
});
