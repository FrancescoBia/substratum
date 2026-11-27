import Logo from "@repo/ui/assets/logo/substratum_logo.svg?react";
import type { ReactNode } from "react";
import { APP_VERSION } from "~/lib/version";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-10">
      <main className="flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-sm">
          <Logo aria-label="Substratum" className="mb-8 size-9 [&_path]:fill-foreground" />
          {children}
        </div>
      </main>

      <footer className="flex justify-end text-xs">
        <span className="tabular-nums">v{APP_VERSION}</span>
      </footer>
    </div>
  );
}
