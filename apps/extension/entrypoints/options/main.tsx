import { ThemeProvider } from "@repo/ui/components/theme-provider";
import React from "react";
import ReactDOM from "react-dom/client";
import { Options } from "./Options";
import "./style.css";

/**
 * `system` rather than the web app's `dark` default: this page has no theme
 * switcher, and following the browser is what the hand-rolled stylesheet it
 * replaced did. ThemeScript is deliberately absent — it exists to beat the
 * first paint of a server-rendered page, and an MV3 page could not run it
 * anyway, since the default extension CSP blocks inline scripts.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system">
      <Options />
    </ThemeProvider>
  </React.StrictMode>,
);
