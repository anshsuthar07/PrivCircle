CREATE TABLE "room_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"room_path" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(255) NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE INDEX "room_documents_room_expires_idx" ON "room_documents" USING btree ("room_id","expires_at");--> statement-breakpoint
CREATE INDEX "room_documents_expires_at_idx" ON "room_documents" USING btree ("expires_at");