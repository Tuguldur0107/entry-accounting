CREATE TABLE "vat_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"output_vat_account_number" text DEFAULT '31410000' NOT NULL,
	"input_vat_account_number" text DEFAULT '13620000' NOT NULL,
	"vat_rate_percent" numeric(5, 2) DEFAULT '10' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vat_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "vat_settings" ADD CONSTRAINT "vat_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;