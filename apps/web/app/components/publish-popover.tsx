import { Button, buttonVariants } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { Switch } from "@repo/ui/components/switch";
import { cn } from "cn";
import {
  CheckIcon,
  CopyIcon,
  GlobeIcon,
  GlobeOffIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

export function PublishPopover({
  boardId,
  published,
  publicUrl,
}: {
  boardId: string;
  published: boolean;
  /** Null until the first publish mints the slug. */
  publicUrl: string | null;
}) {
  const fetcher = useFetcher();
  const pendingIntent = fetcher.formData?.get("intent");
  const isPublic = pendingIntent ? pendingIntent === "publish" : published;

  function setPublic(next: boolean) {
    fetcher.submit(
      { intent: next ? "publish" : "unpublish", boardId },
      { method: "post", action: "/boards" },
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm">
            {published ? <GlobeIcon /> : <GlobeOffIcon />}
            {/*
              Workaround to avoid the button width jumping between the two states.
             (Particularly visible when other elements are stacked horizontally.)
             */}
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", !published && "invisible")}>
                Public
              </span>
              <span className={cn("col-start-1 row-start-1", published && "invisible")}>
                Private
              </span>
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 rounded-md p-0.5 text-[13px]">
        <div className="px-2 py-1.5">
          <Label className="h-5 justify-between gap-1.5 text-[13px]">
            Public URL
            <Switch size="sm" checked={isPublic} onCheckedChange={setPublic} />
          </Label>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {isPublic
              ? "Anyone with the link can view this board."
              : "Only you can see this board."}
          </p>
        </div>
        {/* The slug is frozen at first publish, so this link keeps working even
            after the board is renamed. */}
        {isPublic && publicUrl && (
          <>
            <div className="bg-border -mx-0.5 my-0.5 h-px" />
            <PublicUrl url={publicUrl} />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PublicUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // The Clipboard API needs a secure context; over plain HTTP the link is
      // still there to select by hand.
    }
  }

  return (
    <div className="flex h-8 items-center gap-1 px-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className={cn(
          buttonVariants({ variant: "secondary", size: "xs" }),
          "min-w-0 shrink border-border",
        )}
      >
        <SquareArrowOutUpRightIcon />
        <span className="truncate">{url.replace(/^https?:\/\//, "")}</span>
      </a>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={copy}
        // Wide enough for "Copied", so the URL's truncation doesn't jump.
        className="min-w-17 justify-start"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
