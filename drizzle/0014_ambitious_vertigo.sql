ALTER TABLE "documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "pages_extracted" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_partial" boolean DEFAULT false NOT NULL;