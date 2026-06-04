CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_number" text NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'MNT' NOT NULL,
	"opening_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"date" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"contra_account" text NOT NULL,
	"cf_category" text DEFAULT 'operating' NOT NULL,
	"counterparty" text DEFAULT '',
	"description" text NOT NULL,
	"reference" text DEFAULT '',
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"recon_status" text DEFAULT 'unreconciled' NOT NULL,
	"voucher_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_tx_direction_chk" CHECK ("bank_transactions"."direction" in ('inflow','outflow')),
	CONSTRAINT "bank_tx_cf_category_chk" CHECK ("bank_transactions"."cf_category" in ('operating','investing','financing')),
	CONSTRAINT "bank_tx_status_chk" CHECK ("bank_transactions"."status" in ('draft','posted')),
	CONSTRAINT "bank_tx_source_chk" CHECK ("bank_transactions"."source" in ('manual','ar','ap','import')),
	CONSTRAINT "bank_tx_recon_chk" CHECK ("bank_transactions"."recon_status" in ('unreconciled','matched','cleared')),
	CONSTRAINT "bank_tx_amount_positive_chk" CHECK ("bank_transactions"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;