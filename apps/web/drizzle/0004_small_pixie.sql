ALTER TABLE `images` ADD `kind` text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE `images` ADD `duration_ms` integer;