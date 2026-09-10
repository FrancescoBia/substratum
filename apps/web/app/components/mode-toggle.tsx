import { Moon, Sun } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { useTheme } from "@repo/ui/components/theme-provider";

/**
 * Styled to sit in the sidebar footer alongside Export all and Sign out, so the
 * trigger is a full-width ghost row rather than shadcn's standalone icon button.
 */
export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
      >
        {/* Sun and moon cross-fade in place: one grid cell holds both, so they
            overlap without either leaving the flow and pushing the label. */}
        <span className="grid size-4 shrink-0">
          <Sun className="col-start-1 row-start-1 size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="col-start-1 row-start-1 size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </span>
        Theme
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
