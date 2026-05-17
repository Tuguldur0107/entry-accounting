CREATE TABLE "module_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"module_key" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_configs_user_id_module_key_unique" UNIQUE("user_id","module_key")
);
--> statement-breakpoint
CREATE TABLE "segment_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"segment_id" integer NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"modules" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "segment_configs_user_id_segment_id_unique" UNIQUE("user_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "segment_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"segment_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"modules" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "segment_values_user_id_segment_id_code_unique" UNIQUE("user_id","segment_id","code")
);
--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "is_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD COLUMN "modules" text DEFAULT 'gl,ar,ap,fa,cost,cash' NOT NULL;--> statement-breakpoint
ALTER TABLE "module_configs" ADD CONSTRAINT "module_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_configs" ADD CONSTRAINT "segment_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_values" ADD CONSTRAINT "segment_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;