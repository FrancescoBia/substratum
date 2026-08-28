CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`format` text NOT NULL,
	`byte_size` integer NOT NULL,
	`source_image_url` text,
	`source_page_url` text,
	`source_page_title` text,
	`note` text DEFAULT '' NOT NULL,
	`saved_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `images_stream_idx` ON `images` (`deleted_at`,`saved_at`);