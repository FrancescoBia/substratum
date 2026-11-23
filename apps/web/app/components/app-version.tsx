import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { ArrowUpRightIcon } from "lucide-react";
import type { AvailableUpdate } from "~/lib/update-check.server";
import { APP_VERSION } from "~/lib/version";

export const AppVersion = ({ update }: { update?: AvailableUpdate | null }) => {
  if (!update) return <h4 className="px-2 text-xs opacity-50">v{APP_VERSION}</h4>;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={`v${APP_VERSION}, update available`}
            title="Update available"
          />
        }
      >
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />v{APP_VERSION}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto space-y-1">
        <p className="font-medium">v{update.version} is available</p>
        <a
          href={update.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Release notes
          <ArrowUpRightIcon className="size-3" />
        </a>
      </PopoverContent>
    </Popover>
  );
};
