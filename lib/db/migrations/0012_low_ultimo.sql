CREATE TABLE "fa_depreciation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_month" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"voucher_id" uuid,
	"reversal_voucher_id" uuid,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"acquisition_date" text NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"salvage_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"useful_life_months" integer DEFAULT 0 NOT NULL,
	"depreciation_start_month" text,
	"asset_account_number" text DEFAULT '21010000' NOT NULL,
	"accum_dep_account_number" text DEFAULT '21000099' NOT NULL,
	"dep_expense_account_number" text DEFAULT '70000001' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_voucher_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_assets_user_id_code_unique" UNIQUE("user_id","code")
);
--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD CONSTRAINT "fa_depreciation_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD CONSTRAINT "fa_depreciation_entries_asset_id_fixed_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."fixed_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD CONSTRAINT "fa_depreciation_entries_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fa_depreciation_entries" ADD CONSTRAINT "fa_depreciation_entries_reversal_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("reversal_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_source_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("source_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;