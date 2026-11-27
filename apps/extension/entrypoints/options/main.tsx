import { ThemeProvider } from "@repo/ui/components/theme-provider";
import React from "react";
import ReactDOM from "react-dom/client";
import { Options } from "./Options";
import "./style.css";

/**
 * ThemeScript is deliberately absent — it exists to beat the first paint of a
 * server-rendered page, and an MV3 page could not run it anyway, since the
 * default extension CSP blocks inline scripts.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <Options />
    </ThemeProvider>
  </React.StrictMode>,
);
