CREATE TABLE IF NOT EXISTS "ar_ap_document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"account_number" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ar_ap_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_no" text NOT NULL,
	"document_type" text NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"date" text NOT NULL,
	"due_date" text NOT NULL,
	"currency" text DEFAULT 'MNT' NOT NULL,
	"control_account_number" text NOT NULL,
	"description" text NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"voucher_id" uuid,
	"reversal_voucher_id" uuid,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ar_ap_documents_user_id_document_no_unique" UNIQUE("user_id","document_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ar_ap_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"cash_document_id" uuid,
	"settlement_date" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"counterparty_type" text DEFAULT 'both' NOT NULL,
	"register_no" text,
	"default_receivable_account_number" text,
	"default_payable_account_number" text,
	"default_currency" text DEFAULT 'MNT' NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "counterparties_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "cash_documents" ADD COLUMN IF NOT EXISTS "source_voucher_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_document_lines" ADD CONSTRAINT "ar_ap_document_lines_document_id_ar_ap_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."ar_ap_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_documents" ADD CONSTRAINT "ar_ap_documents_reversal_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("reversal_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_settlements" ADD CONSTRAINT "ar_ap_settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_settlements" ADD CONSTRAINT "ar_ap_settlements_document_id_ar_ap_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."ar_ap_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ar_ap_settlements" ADD CONSTRAINT "ar_ap_settlements_cash_document_id_cash_documents_id_fk" FOREIGN KEY ("cash_document_id") REFERENCES "public"."cash_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_documents" ADD CONSTRAINT "cash_documents_source_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("source_voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
