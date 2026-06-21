CREATE TABLE "artifact_versions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "artifact_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"artifact_id" integer NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"format" text,
	"content" text,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artifact_versions_artifact_id" ON "artifact_versions" USING btree ("artifact_id");