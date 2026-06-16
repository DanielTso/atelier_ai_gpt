ALTER TABLE "message_attachments" ALTER COLUMN "data_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "storage_path" text;