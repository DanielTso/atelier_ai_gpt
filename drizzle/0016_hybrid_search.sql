CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_tsv" ON "document_chunks" USING gin ("content_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_trgm" ON "document_chunks" USING gin ("content" gin_trgm_ops);
