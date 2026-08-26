CREATE TABLE "lifetime_documents" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifetime_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"path" varchar(64) NOT NULL,
	"password_required" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifetime_rooms_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "lifetime_documents" ADD CONSTRAINT "lifetime_documents_room_id_lifetime_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."lifetime_rooms"("id") ON DELETE cascade ON UPDATE no action;