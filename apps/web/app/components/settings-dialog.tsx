import { Button, buttonVariants } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { useTheme } from "@repo/ui/components/theme-provider";
import { cn } from "cn";
import {
  ChevronRightIcon,
  DownloadIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import type { loader as libraryLoader } from "~/routes/library";

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) => {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 border-t py-4">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {children}
    </section>
  );
};

export const SettingsDialog = () => {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const trashCount = useRouteLoaderData<typeof libraryLoader>("routes/library")?.trashCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="xs" aria-label="Settings" title="Settings" />}
      >
        <SettingsIcon className="size-icon" /> Settings
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Theme, export, and Trash for this library.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Section title="Theme" description="How Substratum looks on this device.">
            <div className="bg-muted flex gap-1 rounded-lg p-1">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  size="sm"
                  variant="ghost"
                  aria-pressed={theme === value}
                  className={cn(theme === value && "bg-background shadow-sm")}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="size-4" /> {label}
                </Button>
              ))}
            </div>
          </Section>

          <Section title="Export" description="Download every Image and its metadata as one file.">
            <a
              href="/export"
              download
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <DownloadIcon className="size-4" /> Export all
            </a>
          </Section>

          <Section
            title="Trash"
            description={
              trashCount === 0
                ? "Nothing in the Trash."
                : `${trashCount} item${trashCount === 1 ? "" : "s"} waiting to be restored or purged.`
            }
          >
            <Link
              to="/trash"
              onClick={() => setOpen(false)}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Trash2Icon className="size-4" /> Open Trash
              <ChevronRightIcon className="size-4" />
            </Link>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
