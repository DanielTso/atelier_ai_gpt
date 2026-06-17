CREATE TABLE "artifacts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "artifacts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chat_id" integer NOT NULL,
	"project_id" integer,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artifacts_chat_id" ON "artifacts" USING btree ("chat_id");