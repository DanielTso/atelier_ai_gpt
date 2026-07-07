ALTER TABLE "artifact_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "generated_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "idx_artifacts_project_id" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_document_revisions_project_id" ON "document_revisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_memory_suggestions_chat_id" ON "memory_suggestions" USING btree ("chat_id");