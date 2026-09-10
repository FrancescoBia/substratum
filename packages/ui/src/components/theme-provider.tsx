import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

// Shared by <ThemeScript> and <ThemeProvider> so the pre-paint script and the
// React state can never disagree about where the theme is stored.
const DEFAULT_THEME: Theme = "dark";
const STORAGE_KEY = "ui-theme";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: DEFAULT_THEME,
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/**
 * Applies the stored theme to <html> before the first paint. Render it in
 * <head>: the app is server-rendered, so without it the document is painted
 * with the default theme and only corrected once React hydrates.
 */
export function ThemeScript({
  defaultTheme = DEFAULT_THEME,
  storageKey = STORAGE_KEY,
}: Omit<ThemeProviderProps, "children"> = {}) {
  const script = `(function () {
  try {
    var theme = localStorage.getItem(${JSON.stringify(storageKey)}) || ${JSON.stringify(defaultTheme)};
    if (theme === "system") {
      theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.classList.add(theme);
  } catch (e) {
    // Storage can be unavailable (private mode, blocked cookies) — fall back
    // to whatever the stylesheet defaults to rather than breaking the page.
  }
})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = STORAGE_KEY,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() =>
    // No localStorage on the server; the default is enough there because the
    // theme only ever reaches the DOM as a class on <html>, which ThemeScript
    // has already set correctly by the time we hydrate.
    typeof window === "undefined"
      ? defaultTheme
      : ((window.localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme),
  );

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      window.localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
