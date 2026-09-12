CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"mime_type" varchar(127) NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "attachments_file_size_non_negative_check" CHECK ("attachments"."file_size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_expense_created_at_idx" ON "attachments" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments" USING btree ("uploaded_by_id");