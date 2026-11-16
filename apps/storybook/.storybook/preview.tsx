import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";

import "./storybook.css";

/**
 * The theme contract is a `.dark` / `.light` class on <html> (see
 * theme-provider). Set it directly from the toolbar rather than mounting
 * ThemeProvider, which would also read and write the app's localStorage key.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as "light" | "dark";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  // globals.css already paints <body> with the theme's background.
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Light or dark theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "light", title: "Light", icon: "sun" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    // Matches DEFAULT_THEME in theme-provider.
    theme: "dark",
  },
  parameters: {
    controls: { expanded: true },
  },
};

export default preview;
