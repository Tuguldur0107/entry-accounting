CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"bank_name" text,
	"account_number" text,
	"currency" text DEFAULT 'MNT' NOT NULL,
	"gl_account_number" text NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_no" text NOT NULL,
	"document_type" text NOT NULL,
	"date" text NOT NULL,
	"from_cash_account_id" uuid,
	"to_cash_account_id" uuid,
	"counter_account_number" text,
	"cash_flow_code" text,
	"counterparty" text,
	"description" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"voucher_id" uuid,
	"reversal_voucher_id" uuid,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cash_documents_user_id_document_no_unique" UNIQUE("user_id","document_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_line_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"report_type" text NOT NULL,
	"line_key" text NOT NULL,
	"account_numbers" text DEFAULT '' NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"custom_label" text,
	"custom_group" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "report_line_mappings_user_id_report_type_line_key_unique" UNIQUE("user_id","report_type","line_key")
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_from_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("from_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_to_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("to_cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_reversal_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("reversal_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_line_mappings" ADD CONSTRAINT "report_line_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
