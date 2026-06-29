CREATE TABLE "bank_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"transaction_date" text NOT NULL,
	"value_date" text,
	"description" text NOT NULL,
	"counterparty" text,
	"counter_account" text,
	"income" numeric(18, 2) DEFAULT '0' NOT NULL,
	"expense" numeric(18, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(18, 2),
	"debit_account_number" text NOT NULL,
	"credit_account_number" text NOT NULL,
	"raw_data" text,
	"cash_document_id" uuid,
	"voucher_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_lines_statement_id_row_number_unique" UNIQUE("statement_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"bank_name" text,
	"period_start" text,
	"period_end" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"total_income" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_expense" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_user_id_file_hash_unique" UNIQUE("user_id","file_hash")
);
--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_cash_document_id_cash_documents_id_fk" FOREIGN KEY ("cash_document_id") REFERENCES "public"."cash_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_voucher_id_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."journal_vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_cash_account_id_cash_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."cash_accounts"("id") ON DELETE restrict ON UPDATE no action;